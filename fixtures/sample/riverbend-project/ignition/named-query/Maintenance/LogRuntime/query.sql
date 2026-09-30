INSERT INTO maint.pump_runtime (equipment_id, hours, t_stamp)
SELECT id, :Hours, CURRENT_TIMESTAMP FROM maint.equipment WHERE name = :PumpName