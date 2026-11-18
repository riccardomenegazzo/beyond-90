"""An invented virtual machine inventory, in the shape of a common export (one machine per row, vInfo-like columns).

Every name and number here is made up. Run it to regenerate kestrel-vinfo.csv; the workshop reads it as an example.
"""

from __future__ import annotations

import csv
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
OS = [("Microsoft Windows Server 2019 (64-bit)", 28), ("Microsoft Windows Server 2022 (64-bit)", 22), ("Microsoft Windows Server 2016 (64-bit)", 14),
      ("Microsoft Windows Server 2012 R2 (64-bit)", 8), ("Microsoft Windows Server 2008 R2 (64-bit)", 2), ("Red Hat Enterprise Linux 8 (64-bit)", 10),
      ("Red Hat Enterprise Linux 7 (64-bit)", 5), ("CentOS 7 (64-bit)", 4), ("Ubuntu Linux (64-bit) 22.04", 4), ("SUSE Linux Enterprise 15 (64-bit)", 3)]
CLUSTERS = [("MIL-DC1", "CL-PROD-01", 9, 220), ("MIL-DC1", "CL-PROD-02", 8, 180), ("MIL-DC1", "CL-VDI", 6, 90), ("TOR-DC2", "CL-DR-01", 6, 70), ("TOR-DC2", "CL-TEST", 4, 60)]
SIZES = [(2, 4096), (2, 8192), (4, 8192), (4, 16384), (8, 32768), (16, 65536)]


def main() -> None:
    rnd = random.Random(2026)
    os_pool = [o for o, w in OS for _ in range(w)]
    rows = []
    for dc, cluster, hosts, count in CLUSTERS:
        for i in range(count):
            cpu, mem = rnd.choices(SIZES, weights=[18, 26, 24, 16, 11, 5])[0]
            prov = rnd.choice([40, 60, 80, 120, 200, 500, 1000]) * 1024
            rows.append({"VM": f"{cluster.lower()}-vm{i + 1:03d}", "Powerstate": "poweredOff" if rnd.random() < 0.12 else "poweredOn", "Template": "False",
                         "CPUs": cpu, "Memory": mem, "Provisioned MiB": prov, "In Use MiB": int(prov * rnd.uniform(0.35, 0.85)),
                         "OS according to the configuration file": rnd.choice(os_pool), "Datacenter": dc, "Cluster": cluster,
                         "Host": f"{cluster.lower()}-esx{rnd.randint(1, hosts):02d}"})
    rows.append({**rows[0], "VM": "tpl-windows-2022", "Template": "True", "Powerstate": "poweredOff"})
    with open(HERE / "kestrel-vinfo.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


if __name__ == "__main__":
    main()
