"""Pump commands and runtime helpers for the Riverbend pump station (sample)."""

def start(pumpPath):
    """Request a pump start; the PLC enforces permissives."""
    system.tag.writeBlocking([pumpPath + "/Cmd/Start"], [True])

def stop(pumpPath):
    """Request a pump stop."""
    system.tag.writeBlocking([pumpPath + "/Cmd/Stop"], [True])

def runtimeHours(pumpName):
    """Total logged runtime for one pump, from the maintenance database."""
    return system.db.runNamedQuery("Maintenance/RuntimeHours", {"PumpName": pumpName})

def logAllRuntimes():
    """Copy current runtime counters into the maintenance log."""
    for name in ["P101", "P102", "P103"]:
        hours = system.tag.readBlocking(["[default]Riverbend/Pumps/%s/RuntimeHours" % name])[0].value
        system.db.runNamedQuery("Maintenance/LogRuntime", {"PumpName": name, "Hours": hours})
