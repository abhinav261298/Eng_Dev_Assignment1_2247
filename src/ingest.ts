import { parse } from 'csv-parse/sync';
import { readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { openDatabase, applySchema, DEFAULT_DB_PATH, Db } from './db';
import { logger } from './logger';

const DATA_DIR = join(__dirname, '..', 'sample-data-set');

type CsvRow = Record<string, string>;

interface ColumnSpec {
  readonly name: string;
  readonly kind: 'int' | 'real' | 'text';
}

interface TableSpec {
  readonly table: string;
  readonly file: string;
  readonly columns: readonly ColumnSpec[];
}

const int = (name: string): ColumnSpec => ({ name, kind: 'int' });
const real = (name: string): ColumnSpec => ({ name, kind: 'real' });
const text = (name: string): ColumnSpec => ({ name, kind: 'text' });

const TABLE_SPECS: readonly TableSpec[] = [
  {
    table: 'clients',
    file: 'clients.csv',
    columns: [int('client_id'), text('client_name'), text('gst_number'), text('contact_person'),
      text('contact_phone'), text('contact_email'), text('address_line1'), text('address_line2'),
      text('city'), text('state'), text('pincode'), text('created_at')]
  },
  {
    table: 'drivers',
    file: 'drivers.csv',
    columns: [int('driver_id'), text('driver_name'), text('phone'), text('license_number'),
      text('partner_company'), text('city'), text('state'), text('status'), text('created_at')]
  },
  {
    table: 'warehouses',
    file: 'warehouses.csv',
    columns: [int('warehouse_id'), text('warehouse_name'), text('state'), text('city'),
      text('pincode'), int('capacity'), text('manager_name'), text('contact_phone'), text('created_at')]
  },
  {
    table: 'orders',
    file: 'orders.csv',
    columns: [int('order_id'), int('client_id'), text('customer_name'), text('customer_phone'),
      text('delivery_address_line1'), text('delivery_address_line2'), text('city'), text('state'),
      text('pincode'), text('order_date'), text('promised_delivery_date'), text('actual_delivery_date'),
      text('status'), text('payment_mode'), real('amount'), text('failure_reason'), text('created_at')]
  },
  {
    table: 'fleet_logs',
    file: 'fleet_logs.csv',
    columns: [int('fleet_log_id'), int('order_id'), int('driver_id'), text('vehicle_number'),
      text('route_code'), text('gps_delay_notes'), text('departure_time'), text('arrival_time'),
      text('created_at')]
  },
  {
    table: 'warehouse_logs',
    file: 'warehouse_logs.csv',
    columns: [int('log_id'), int('order_id'), int('warehouse_id'), text('picking_start'),
      text('picking_end'), text('dispatch_time'), text('notes')]
  },
  {
    table: 'external_factors',
    file: 'external_factors.csv',
    columns: [int('factor_id'), int('order_id'), text('traffic_condition'),
      text('weather_condition'), text('event_type'), text('recorded_at')]
  },
  {
    table: 'feedback',
    file: 'feedback.csv',
    columns: [int('feedback_id'), int('order_id'), text('customer_name'), text('feedback_text'),
      text('sentiment'), int('rating'), text('created_at')]
  }
];

const coerceValue = (raw: string | undefined, kind: ColumnSpec['kind']): string | number | null => {
  const trimmed = raw === undefined ? '' : raw.trim();
  if (trimmed === '') return null;
  if (kind === 'int') {
    const parsed = Number.parseInt(trimmed, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (kind === 'real') {
    const parsed = Number.parseFloat(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return trimmed;
};

export const ingestTable = (db: Db, spec: TableSpec, dataDir: string = DATA_DIR): number => {
  const csvContent = readFileSync(join(dataDir, spec.file), 'utf-8');
  const rows: CsvRow[] = parse(csvContent, { columns: true, skip_empty_lines: true });
  const columnNames = spec.columns.map((column) => column.name);
  const placeholders = columnNames.map(() => '?').join(', ');
  const insert = db.prepare(
    `INSERT INTO ${spec.table} (${columnNames.join(', ')}) VALUES (${placeholders})`
  );
  const insertAll = db.transaction((allRows: CsvRow[]) => {
    for (const row of allRows) {
      insert.run(spec.columns.map((column) => coerceValue(row[column.name], column.kind)));
    }
  });
  insertAll(rows);
  return rows.length;
};

interface DataQualityCheck {
  readonly label: string;
  readonly sql: string;
  readonly expected?: number;
}

const DQ_CHECKS: readonly DataQualityCheck[] = [
  { label: 'orders rows', sql: 'SELECT COUNT(*) n FROM orders', expected: 10000 },
  { label: 'clients rows', sql: 'SELECT COUNT(*) n FROM clients', expected: 500 },
  { label: 'drivers rows', sql: 'SELECT COUNT(*) n FROM drivers', expected: 2000 },
  { label: 'warehouses rows', sql: 'SELECT COUNT(*) n FROM warehouses', expected: 50 },
  { label: 'fleet_logs rows', sql: 'SELECT COUNT(*) n FROM fleet_logs', expected: 10000 },
  { label: 'warehouse_logs rows', sql: 'SELECT COUNT(*) n FROM warehouse_logs', expected: 10000 },
  { label: 'external_factors rows', sql: 'SELECT COUNT(*) n FROM external_factors', expected: 10000 },
  { label: 'feedback rows', sql: 'SELECT COUNT(*) n FROM feedback', expected: 10000 },
  {
    label: 'orders with unknown client_id (orphans)',
    sql: 'SELECT COUNT(*) n FROM orders o LEFT JOIN clients c ON c.client_id = o.client_id WHERE c.client_id IS NULL',
    expected: 0
  },
  {
    label: 'fleet_logs with unknown order/driver (orphans)',
    sql: `SELECT COUNT(*) n FROM fleet_logs f
          LEFT JOIN orders o ON o.order_id = f.order_id
          LEFT JOIN drivers d ON d.driver_id = f.driver_id
          WHERE o.order_id IS NULL OR d.driver_id IS NULL`,
    expected: 0
  },
  {
    label: 'warehouse_logs with unknown order/warehouse (orphans)',
    sql: `SELECT COUNT(*) n FROM warehouse_logs w
          LEFT JOIN orders o ON o.order_id = w.order_id
          LEFT JOIN warehouses wh ON wh.warehouse_id = w.warehouse_id
          WHERE o.order_id IS NULL OR wh.warehouse_id IS NULL`,
    expected: 0
  },
  { label: 'failed orders', sql: "SELECT COUNT(*) n FROM orders WHERE status = 'Failed'", expected: 2004 },
  {
    label: 'failed orders missing failure_reason',
    sql: "SELECT COUNT(*) n FROM orders WHERE status = 'Failed' AND failure_reason IS NULL",
    expected: 0
  },
  {
    label: 'late delivered orders (actual > promised)',
    sql: 'SELECT COUNT(*) n FROM v_order_outcome WHERE is_late = 1',
    expected: 1271
  },
  { label: 'distinct orders with fleet logs', sql: 'SELECT COUNT(DISTINCT order_id) n FROM fleet_logs', expected: 6335 },
  { label: 'distinct orders with warehouse logs', sql: 'SELECT COUNT(DISTINCT order_id) n FROM warehouse_logs', expected: 6324 },
  {
    label: 'orders touching >1 warehouse (pair-level attribution required)',
    sql: 'SELECT COUNT(*) n FROM (SELECT order_id FROM warehouse_logs GROUP BY order_id HAVING COUNT(DISTINCT warehouse_id) > 1)',
    expected: 2598
  }
];

export const runDataQualityReport = (db: Db): boolean => {
  logger.info('--- data quality report ---');
  let allPassed = true;
  for (const check of DQ_CHECKS) {
    const { n } = db.prepare(check.sql).get() as { n: number };
    const passed = check.expected === undefined || n === check.expected;
    if (!passed) allPassed = false;
    logger.info(
      `${passed ? 'PASS' : 'FAIL'} ${check.label}: ${n}` +
        (check.expected !== undefined ? ` (expected ${check.expected})` : '')
    );
  }
  return allPassed;
};

export const runIngest = (dbPath: string = DEFAULT_DB_PATH, dataDir: string = DATA_DIR): boolean => {
  if (existsSync(dbPath)) {
    logger.info('removing previous database file', { dbPath });
    rmSync(dbPath);
  }
  const db = openDatabase(dbPath);
  try {
    applySchema(db);
    for (const spec of TABLE_SPECS) {
      const count = ingestTable(db, spec, dataDir);
      logger.info(`ingested ${spec.table}`, { rows: count });
    }
    return runDataQualityReport(db);
  } finally {
    db.close();
  }
};

if (require.main === module) {
  const passed = runIngest();
  if (!passed) {
    logger.error('data quality report has failures — inspect before continuing');
    process.exitCode = 1;
  } else {
    logger.info('ingestion complete: all data quality checks passed');
  }
}
