SELECT SUM(hours) AS total_hours
FROM maint.pump_runtime r
JOIN maint.equipment e ON e.id = r.equipment_id
WHERE e.name = :PumpName