# A worked case: a platform move, from the export to the proof

This is one prospect, Kestrel Logistics, told from the first meeting to the proof of value. The company is invented, and so is its inventory, but every number below is what the page works out from that inventory and the figures said in the meeting. To follow along, open the [live page](https://riccardomenegazzo.github.io/beyond-90/) and press "See a filled-in example" beside "A new prospect, no data yet?", or open [the presales desk with invented prospects](https://riccardomenegazzo.github.io/beyond-90/?start=presales).

Nothing here is a quote or a sizing. Each number is an order of magnitude to agree with the customer before the vendor's own tools take over.

## Before the meeting

Kestrel is leaving its virtualisation platform and worries about recovery. The lines in scope are the platform move and its neighbours: hyperconverged infrastructure, platform migration, disaster recovery, backups on object storage and databases. **Copy the questions to send ahead** gives a short note for their team: the factual questions they can answer in writing, grouped by who would answer them. As long as no inventory has been read, the note ends with the one file the sizing and the plan in waves start from: an export of the virtual machine inventory, one row per machine, with the promise that only the totals are kept.

## The export arrives

Their export is read in the page, and only the totals are kept: 620 virtual machines, 537 of them running, 2,166 vCPU and 7,236 GiB of memory in use, 102 TiB of storage used, on 33 hosts in 5 clusters. 83 machines are powered off: candidates to retire rather than move. 141 run operating systems past general support. The largest clusters show the data on each, and a small cluster with little past support, CL-TEST, is proposed for a first wave.

## A first sizing, in the room

**A first sizing sketch** turns the inventory into servers with assumptions anyone can argue with: 15% growth, 4 vCPU per physical core, two copies of the data, one spare server, servers of 64 cores, 1,024 GiB and 30 TiB. The answer is **13 servers, decided by compute** (compute 12, memory 9, storage 11), with CPU at 92.7% once a server is down. That is the number to discuss, not the 13.

What the customer says goes in with a tap. "We plan for 30% growth, on servers with 48 cores and 1.5 TB of memory, N+2" offers four figures for the sizing sketch in one card, and **Use all 4 in the sketch** puts them in; one **Undo** takes them back. "Today our hosts have 2 x 16 cores" is today's hosts, not the new servers.

Two licence questions come up in every such meeting, and the sketch answers both in their numbers:

- **How many cores would a per-core subscription count?** 13 servers x 64 cores = 832 physical cores, the spare server included. With 32 cores in each of today's 33 hosts, that is 1,056 today, so 224 fewer.
- **Fewer larger servers, or more smaller ones?** **Compare with another server** sizes the same estate on 128 cores, 2,048 GiB and 60 TiB: 7 servers instead of 13, but 896 physical cores instead of 832. Fewer servers can mean more cores to license, and a larger server takes more with it when it fails.

## How the move would run

**A plan in waves** proposes a test wave of 20 machines on CL-TEST, then cluster by cluster, the least risky first: 14 waves, a week apart, for the 537 running machines. Each wave says the data it copies ahead of its cutover and how long that takes over their link: 89.8 TiB in all, the largest wave 8.3 TiB, about 29 hours at 1,000 Mbit/s counting on 70% of the link, so its copy starts three days before its cutover (the calendar export carries that day too). Over a thin link the plan says when a copy no longer fits between two waves, and what to change: more bandwidth, more days between waves, or smaller waves.

"They can move 30 machines a weekend, a wave every two weeks, over a 10 Gbit link between the data centres" goes into the plan from Heard something the same way.

## Recovery

**A first recovery design** takes the data to protect (60 TiB here) and the distance between the sites (4 ms), and gives each tier of applications its replication and the bandwidth it needs: synchronous replication with a witness for the 9 TiB that cannot lose anything, near-continuous replication for the next 21 TiB, scheduled snapshots for the last 30 TiB, about 551 Mbit/s between the sites in all, before compression.

## What the customer takes away

With **Show the sketches worked out with their figures in the customer readout** ticked, the readout lists the first orders of magnitude, one line each: the platform with its physical cores (and the difference from today, once today's cores are known), the recovery design, the backups and the databases, and, once the plan in waves has the customer's pace, the move with its waves and the data copied ahead. They are labelled as what they are: an order of magnitude, not a quote.

## The proof of value

A proof of value started from this workshop adds a test for each sketch worked out with the customer's figures, each with the figure it would confirm (the first three join its criteria when it starts, and any other can be added by hand). For the sketches above:

- a week of the current platform's figures (processor ready time, memory in use, storage growth) confirms the vCPU per core and the growth the sizing assumed;
- the test wave copies its data ahead over the real link and cuts over inside the agreed window, each owner signing off against the baseline;
- a test failover of one tier over the real link meets its recovery point and recovery time.

The sizing nobody tested is a guess the customer pays for later. These three tests are how the numbers above stop being a sketch.

## Where this sits in the tool

The desk flags a deal that reaches the proof without a sizing or a plan worked out with the customer's figures; the next meeting's agenda asks for the figures still missing; the hand-over to delivery carries the plan and the copy. See [the discovery workshop](workshop.md) for every sketch and assumption, and [running the meetings](meeting.md) for Heard something.
