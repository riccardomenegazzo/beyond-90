"""Automatic data collection.

Beyond 90 used to start from files someone exported. This package starts from a configuration file instead: it
says where each list lives (a REST API, a cloud CLI, a drop folder), how a record maps to the columns the engine
reads, and what the run may reach. The data directory is then built, merged and kept fresh without anyone
exporting anything.

No source is hard-coded. A new vendor API needs a few lines of mapping, not code. Everything is standard library,
secrets come only from environment variables, and every request is checked against an allow-list of hosts.
"""

from .config import Config, ConfigError, load_config
from .fetch import FetchError, fetch_source
from .mapping import MapError, map_records
from .sync import SyncError, SyncReport, sync

__all__ = ["Config", "ConfigError", "FetchError", "MapError", "SyncError", "SyncReport", "fetch_source", "load_config", "map_records", "sync"]
