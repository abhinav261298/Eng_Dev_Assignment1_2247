-- Delivery Root-Cause Analysis POC — SQLite schema
-- 8 base tables mirroring sample-data-set/*.csv, indexes on filter/join columns,
-- and canonical views encoding join / dedup / outcome rules.
-- Dates are stored as ISO-8601 TEXT ("YYYY-MM-DD HH:MM:SS").

-- ============================== base tables ==============================

CREATE TABLE IF NOT EXISTS clients (
  client_id      INTEGER PRIMARY KEY,
  client_name    TEXT NOT NULL,
  gst_number     TEXT,
  contact_person TEXT,
  contact_phone  TEXT,
  contact_email  TEXT,
  address_line1  TEXT,
  address_line2  TEXT,
  city           TEXT,
  state          TEXT,
  pincode        TEXT,
  created_at     TEXT
);

CREATE TABLE IF NOT EXISTS drivers (
  driver_id       INTEGER PRIMARY KEY,
  driver_name     TEXT NOT NULL,
  phone           TEXT,
  license_number  TEXT,
  partner_company TEXT,
  city            TEXT,
  state           TEXT,
  status          TEXT,          -- Active | Inactive
  created_at      TEXT
);

CREATE TABLE IF NOT EXISTS warehouses (
  warehouse_id   INTEGER PRIMARY KEY,
  warehouse_name TEXT NOT NULL,
  state          TEXT,
  city           TEXT,
  pincode        TEXT,
  capacity       INTEGER,
  manager_name   TEXT,
  contact_phone  TEXT,
  created_at     TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  order_id               INTEGER PRIMARY KEY,
  client_id              INTEGER NOT NULL REFERENCES clients(client_id),
  customer_name          TEXT,
  customer_phone         TEXT,
  delivery_address_line1 TEXT,
  delivery_address_line2 TEXT,
  city                   TEXT NOT NULL,
  state                  TEXT,
  pincode                TEXT,
  order_date             TEXT NOT NULL,
  promised_delivery_date TEXT,
  actual_delivery_date   TEXT,          -- NULL unless status = 'Delivered'
  status                 TEXT NOT NULL, -- Pending|In-Transit|Delivered|Failed|Returned
  payment_mode           TEXT,          -- COD | Prepaid
  amount                 REAL,
  failure_reason         TEXT,          -- populated only when status = 'Failed'
  created_at             TEXT
);

CREATE TABLE IF NOT EXISTS fleet_logs (
  fleet_log_id    INTEGER PRIMARY KEY,
  order_id        INTEGER NOT NULL REFERENCES orders(order_id),
  driver_id       INTEGER NOT NULL REFERENCES drivers(driver_id),
  vehicle_number  TEXT,
  route_code      TEXT,
  gps_delay_notes TEXT,                 -- Heavy congestion|Breakdown|Address not found|NULL
  departure_time  TEXT,
  arrival_time    TEXT,
  created_at      TEXT
);

CREATE TABLE IF NOT EXISTS warehouse_logs (
  log_id        INTEGER PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(order_id),
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
  picking_start TEXT,
  picking_end   TEXT,
  dispatch_time TEXT,
  notes         TEXT                    -- System issue|Stock delay on item|Slow packing|NULL
);

CREATE TABLE IF NOT EXISTS external_factors (
  factor_id         INTEGER PRIMARY KEY,
  order_id          INTEGER NOT NULL REFERENCES orders(order_id),
  traffic_condition TEXT,               -- Clear|Moderate|Heavy
  weather_condition TEXT,               -- Clear|Rain|Fog
  event_type        TEXT,               -- Holiday|Festival|Strike|NULL
  recorded_at       TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  feedback_id   INTEGER PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(order_id),
  customer_name TEXT,
  feedback_text TEXT,
  sentiment     TEXT,                   -- unreliable: contradicts text/rating (documented DQ issue)
  rating        INTEGER,                -- unreliable: contradicts text/sentiment (documented DQ issue)
  created_at    TEXT
);

-- ================================ indexes ================================

CREATE INDEX IF NOT EXISTS idx_orders_client     ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_city       ON orders(city);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_fleet_order       ON fleet_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_fleet_driver      ON fleet_logs(driver_id);
CREATE INDEX IF NOT EXISTS idx_whlog_order       ON warehouse_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_whlog_warehouse   ON warehouse_logs(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_ext_order         ON external_factors(order_id);
CREATE INDEX IF NOT EXISTS idx_fb_order          ON feedback(order_id);

-- ================================= views =================================

-- One row per order with derived outcome classification. All time filtering anchors
-- on orders dates (order_date / promised_delivery_date); aux-table timestamps are
-- unreliable (97% are >3 days away from the linked order_date).
CREATE VIEW IF NOT EXISTS v_order_outcome AS
SELECT o.*,
  CASE WHEN o.status = 'Failed' THEN 1 ELSE 0 END AS is_failed,
  CASE WHEN o.status = 'Delivered'
        AND o.actual_delivery_date > o.promised_delivery_date THEN 1 ELSE 0 END AS is_late,
  CASE
    WHEN o.status = 'Failed'    THEN 'Failed'
    WHEN o.status = 'Returned'  THEN 'Returned'
    WHEN o.status = 'Delivered' AND o.actual_delivery_date > o.promised_delivery_date THEN 'Late'
    WHEN o.status = 'Delivered' THEN 'On-Time'
    ELSE o.status               -- Pending / In-Transit
  END AS outcome,
  CASE WHEN o.status = 'Delivered'
       THEN ROUND((julianday(o.actual_delivery_date)
                 - julianday(o.promised_delivery_date)) * 24.0, 1)
  END AS delay_hours
FROM orders o;

-- Aux fan-out collapsed to one row per order (evidence flags via MAX to avoid double counting;
-- up to 6 fleet logs exist per order).
CREATE VIEW IF NOT EXISTS v_order_fleet AS
SELECT order_id,
  COUNT(*)                                 AS fleet_log_count,
  COUNT(DISTINCT driver_id)                AS driver_count,
  MAX(gps_delay_notes = 'Heavy congestion')  AS had_congestion,
  MAX(gps_delay_notes = 'Breakdown')         AS had_breakdown,
  MAX(gps_delay_notes = 'Address not found') AS had_address_issue,
  GROUP_CONCAT(DISTINCT gps_delay_notes)   AS fleet_notes
FROM fleet_logs
GROUP BY order_id;

-- Per-order warehouse ops summary; picking/dispatch durations are internally consistent
-- within warehouse_logs even though absolute timestamps are not.
CREATE VIEW IF NOT EXISTS v_order_warehouse AS
SELECT order_id,
  COUNT(*)                                  AS wh_log_count,
  COUNT(DISTINCT warehouse_id)              AS warehouse_count,
  MAX(notes = 'Stock delay on item')        AS had_stock_delay,
  MAX(notes = 'System issue')               AS had_system_issue,
  MAX(notes = 'Slow packing')               AS had_slow_packing,
  ROUND(AVG((julianday(picking_end)  - julianday(picking_start)) * 1440), 1) AS avg_picking_mins,
  ROUND(AVG((julianday(dispatch_time) - julianday(picking_end))  * 1440), 1) AS avg_dispatch_lag_mins,
  GROUP_CONCAT(DISTINCT notes)              AS wh_notes
FROM warehouse_logs
GROUP BY order_id;

-- Condition flags per order.
CREATE VIEW IF NOT EXISTS v_order_external AS
SELECT order_id,
  MAX(traffic_condition = 'Heavy')             AS had_heavy_traffic,
  MAX(weather_condition IN ('Rain', 'Fog'))    AS had_bad_weather,
  MAX(event_type = 'Festival')                 AS had_festival,
  MAX(event_type = 'Holiday')                  AS had_holiday,
  MAX(event_type = 'Strike')                   AS had_strike
FROM external_factors
GROUP BY order_id;

-- Voice of customer per order (text templates only; sentiment/rating excluded as unreliable).
CREATE VIEW IF NOT EXISTS v_order_feedback AS
SELECT order_id,
  COUNT(*)                             AS feedback_count,
  GROUP_CONCAT(DISTINCT feedback_text) AS feedback_texts
FROM feedback
GROUP BY order_id;

-- The denormalized analysis surface: one row per order. LEFT JOINs preserve the ~37% of
-- orders that lack records in a given auxiliary table.
CREATE VIEW IF NOT EXISTS order_360 AS
SELECT oo.*, c.client_name,
       f.had_congestion, f.had_breakdown, f.had_address_issue, f.fleet_notes,
       w.had_stock_delay, w.had_system_issue, w.had_slow_packing,
       w.avg_picking_mins, w.avg_dispatch_lag_mins, w.wh_notes,
       e.had_heavy_traffic, e.had_bad_weather, e.had_festival, e.had_holiday, e.had_strike,
       fb.feedback_texts
FROM v_order_outcome oo
JOIN clients c             ON c.client_id  = oo.client_id
LEFT JOIN v_order_fleet     f ON f.order_id  = oo.order_id
LEFT JOIN v_order_warehouse w ON w.order_id  = oo.order_id
LEFT JOIN v_order_external  e ON e.order_id  = oo.order_id
LEFT JOIN v_order_feedback fb ON fb.order_id = oo.order_id;

-- Pair-level attribution: 2,598 orders touch more than one warehouse, so warehouse analysis
-- must count an order toward every warehouse that handled it ("orders involving X").
CREATE VIEW IF NOT EXISTS v_order_warehouse_pairs AS
SELECT DISTINCT wl.order_id, wl.warehouse_id, wh.warehouse_name, wh.city AS warehouse_city
FROM warehouse_logs wl
JOIN warehouses wh ON wh.warehouse_id = wl.warehouse_id;

-- Same pattern for drivers (2,586 orders have more than one driver).
CREATE VIEW IF NOT EXISTS v_order_driver_pairs AS
SELECT DISTINCT fl.order_id, fl.driver_id, d.partner_company, d.status AS driver_status
FROM fleet_logs fl
JOIN drivers d ON d.driver_id = fl.driver_id;
