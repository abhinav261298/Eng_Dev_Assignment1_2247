import Database from 'better-sqlite3';
import { applySchema, Db } from '../src/db';

/**
 * Builds an in-memory fixture DB with the production schema and a small, fully
 * controlled dataset so test expectations are exact.
 *
 * Layout:
 *  - clients: 1 Acme Corp, 2 Beta Ltd
 *  - warehouses: 1 "Warehouse 1" (Mumbai, cap 100), 2 "Warehouse 2" (Pune, cap 200)
 *  - drivers: 1 active Mumbai (Shadowfax), 2 inactive Pune (In-house)
 *  - Mumbai orders due 2025-08-14: o1 Failed(Incorrect address), o2 Late, o3 On-Time
 *  - Pune order o4 Failed(Stockout), handled by BOTH warehouses (pair-level case), festival-flagged
 *  - o5 Pending (Mumbai, July), o6 Delivered on-time (Pune, July)
 *  - o101.. : 35 failed Delhi orders (Traffic congestion) with congestion fleet notes and
 *    heavy-traffic external records, so association factors clear the n>=30 support threshold
 */
export const createFixtureDb = (): Db => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySchema(db);

  db.exec(`
    INSERT INTO clients (client_id, client_name, city, state) VALUES
      (1, 'Acme Corp', 'Mumbai', 'Maharashtra'),
      (2, 'Beta Ltd', 'Pune', 'Maharashtra');

    INSERT INTO warehouses (warehouse_id, warehouse_name, state, city, capacity) VALUES
      (1, 'Warehouse 1', 'Maharashtra', 'Mumbai', 100),
      (2, 'Warehouse 2', 'Maharashtra', 'Pune', 200);

    INSERT INTO drivers (driver_id, driver_name, partner_company, city, state, status) VALUES
      (1, 'Driver One', 'Shadowfax', 'Mumbai', 'Maharashtra', 'Active'),
      (2, 'Driver Two', 'In-house', 'Pune', 'Maharashtra', 'Inactive');

    INSERT INTO orders (order_id, client_id, city, state, order_date, promised_delivery_date,
                        actual_delivery_date, status, payment_mode, amount, failure_reason) VALUES
      (1, 1, 'Mumbai', 'Maharashtra', '2025-08-10 10:00:00', '2025-08-14 10:00:00', NULL,
       'Failed', 'COD', 500.0, 'Incorrect address'),
      (2, 1, 'Mumbai', 'Maharashtra', '2025-08-11 10:00:00', '2025-08-14 10:00:00',
       '2025-08-15 10:00:00', 'Delivered', 'Prepaid', 750.0, NULL),
      (3, 1, 'Mumbai', 'Maharashtra', '2025-08-12 10:00:00', '2025-08-14 10:00:00',
       '2025-08-13 10:00:00', 'Delivered', 'COD', 900.0, NULL),
      (4, 2, 'Pune', 'Maharashtra', '2025-08-05 10:00:00', '2025-08-08 10:00:00', NULL,
       'Failed', 'COD', 320.0, 'Stockout'),
      (5, 2, 'Mumbai', 'Maharashtra', '2025-07-20 10:00:00', '2025-07-24 10:00:00', NULL,
       'Pending', 'Prepaid', 410.0, NULL),
      (6, 2, 'Pune', 'Maharashtra', '2025-07-05 10:00:00', '2025-07-08 10:00:00',
       '2025-07-07 10:00:00', 'Delivered', 'COD', 610.0, NULL);

    INSERT INTO fleet_logs (fleet_log_id, order_id, driver_id, vehicle_number, route_code,
                            gps_delay_notes, departure_time, arrival_time) VALUES
      (1, 1, 1, 'MH01AB1234', 'R1', 'Address not found', '2025-08-13 09:00:00', '2025-08-13 12:00:00');

    INSERT INTO warehouse_logs (log_id, order_id, warehouse_id, picking_start, picking_end,
                                dispatch_time, notes) VALUES
      (1, 1, 1, '2025-08-11 08:00:00', '2025-08-11 08:08:00', '2025-08-11 08:38:00', NULL),
      (2, 4, 1, '2025-08-06 09:00:00', '2025-08-06 09:10:00', '2025-08-06 09:40:00', 'Stock delay on item'),
      (3, 4, 2, '2025-08-06 11:00:00', '2025-08-06 11:20:00', '2025-08-06 12:00:00', 'System issue');

    INSERT INTO external_factors (factor_id, order_id, traffic_condition, weather_condition,
                                  event_type, recorded_at) VALUES
      (1, 4, 'Clear', 'Clear', 'Festival', '2025-08-06 10:00:00'),
      (2, 2, 'Heavy', 'Rain', NULL, '2025-08-14 10:00:00');

    INSERT INTO feedback (feedback_id, order_id, customer_name, feedback_text, sentiment, rating) VALUES
      (1, 1, 'Cust One', 'Delivery never came, wrong address issue.', 'Negative', 1),
      (2, 2, 'Cust Two', 'Driver was polite but package was delayed.', 'Neutral', 3);
  `);

  const insertOrder = db.prepare(
    `INSERT INTO orders (order_id, client_id, city, state, order_date, promised_delivery_date,
                         actual_delivery_date, status, payment_mode, amount, failure_reason)
     VALUES (?, 2, 'Delhi', 'Delhi', '2025-08-01 10:00:00', '2025-08-03 10:00:00', NULL,
             'Failed', 'COD', 100.0, 'Traffic congestion')`
  );
  const insertFleet = db.prepare(
    `INSERT INTO fleet_logs (fleet_log_id, order_id, driver_id, gps_delay_notes,
                             departure_time, arrival_time)
     VALUES (?, ?, 1, 'Heavy congestion', '2025-08-02 09:00:00', '2025-08-02 12:00:00')`
  );
  const insertExternal = db.prepare(
    `INSERT INTO external_factors (factor_id, order_id, traffic_condition, weather_condition, event_type)
     VALUES (?, ?, 'Heavy', 'Clear', NULL)`
  );
  for (let index = 0; index < 35; index += 1) {
    const orderId = 101 + index;
    insertOrder.run(orderId);
    insertFleet.run(100 + index, orderId);
    insertExternal.run(100 + index, orderId);
  }

  return db;
};
