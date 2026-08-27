# Maintenance Decision Memo — LINE-04 (PLANT-03, Ohio)

**Auto-drafted by the Volta Plant Floor assistant · reviewed and approved by Sam Ortiz (VP Manufacturing Operations)**

## Situation
LINE-04 at PLANT-03 is trending toward an unplanned stop. Bearing vibration has crossed 8 mm/s with bearing temperature above 100 C, climbing over the last three weeks past the maintenance window under sustained high utilization. Failure risk is 0.87 (critical). There is an open corrective work order, and the replacement part (PART-00001) is **not stocked locally** (about a 14-day lead time).

## Options ranked (by net value)
| Action | Downtime cost avoided | Action cost | Net value |
|---|---|---|---|
| **Pull now (recommended)** | $76,560 | $40,000 | **+$36,560** |
| Run to shift end | $8,000 | $76,560 | -$68,560 |
| Expedite parts and run | $22,968 | $5,724 | +$17,244 (part non-local, cannot arrive in time) |

## Recommendation
**Pull LINE-04 now for planned maintenance.** An unplanned stop at $22K/hr, plus expedited-parts premium, far exceeds the planned-window cost. Running to shift end risks the full stop; expediting cannot beat the 14-day lead time.

## Decision
Approved by ankit.yadav@databricks.com. Work order WO-A472 written to the operational store; the at-risk queue and KPIs updated on the next read.
