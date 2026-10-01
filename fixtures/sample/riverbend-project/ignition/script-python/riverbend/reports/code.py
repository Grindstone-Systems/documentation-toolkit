"""Report helpers (sample)."""

def dailySummary(day):
    """Flow totals for the day, used by the Daily report export."""
    mode = system.tag.readBlocking(["[default]Riverbend/Plant/Mode"])[0].value
    return system.db.runNamedQuery("Reports/DailyFlow", {"StartDate": day, "EndDate": system.date.addDays(day, 1)})
