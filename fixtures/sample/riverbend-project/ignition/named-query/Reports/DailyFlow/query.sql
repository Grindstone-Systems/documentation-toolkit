SELECT t_stamp, raw_flow_gpm, finished_flow_gpm
FROM plant_flow_hourly
WHERE t_stamp >= :StartDate AND t_stamp < :EndDate
ORDER BY t_stamp