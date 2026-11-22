# Changelog

All notable changes. Versions follow semantic versioning while below 1.0: minor versions may change formats, and the changelog says so.

## 0.178.0

- **The readout's agenda, for the sponsor, and its invitation.** Under a proof of value's success criteria, **Copy the readout agenda** and **Readout invitation (.ics)** give what we set out to prove, each criterion still counted with how we will know, what the result means (anything not met included), and the decision with the dates to a signed order; and who should be there: the sponsor and the champion by name, and whoever decides. It is the agenda, sent before the meeting: no result is in it. The day starts on the one the mutual plan proposes, three days after the window ends.
- New: `readoutAgenda`, `readoutIcs` and `readoutDay` in `readout.js`, with a test; a browser check on the invitation.

## 0.177.0

- **Heard something under the demo's cards too.** What a customer says during the demo often answers a discovery question, voices a concern or gives a figure. Run the demo now has the same **Heard something?** sheet under its cards as the questions: it finds the question it answers, technical or about the deal, offers a concern the line expects with how to answer it, and files a figure with its question.
- A browser check that it is there, with its matches.
- **Today holds still under the pointer.** Pointing at an action previews where Yield would land beside the number; the preview now keeps its room when it fades, so the page no longer shifts when it appears, which could move the list under the pointer and make a button hard to press. A browser check that failed once in a while because of it is steady again.

## 0.176.0

- **On a phone, a workshop's bar carries the way forward.** The bar at the bottom now offers Questions, Qualify and **Forward** (the phase the prospect is in, and the demo with Run the demo), instead of Tender: in the meetings a phone is used for, the demo comes up far more often than a tender, which stays one tap away under Menu.

## 0.175.0

- **The demo card, tidied.** **Run the demo** now sits at the top of the plan, under its length and who should be there, where it is found in the meeting; the other buttons are grouped by when they are used: before the demo (the invitation and the agenda for the customer), the plan (copy or download it), and after (mark it given).
- The length of the meeting and the invitation's day sit on one line with their labels, instead of under them.

## 0.174.0

- **The demo's agenda, for the customer, and its invitation.** Under the demo plan, **Copy the agenda for the customer** and **Demo invitation (.ics)** (on the day chosen) give what will be shown and for how long, in their order (their situation, the result first, each gap that fits, their concerns, what a proof would have to show), and who should be there. It speaks to them: no quote from the discovery notes, nothing left out because they have it, no advice to the seller. Both leave the page through the same check as every copy and file.
- New: `demoAgenda` and `demoIcs` in `forward.js`, with a test; a browser check on the invitation.

## 0.173.0

- **The demo plan says who should be there:** the executive sponsor, then the people each part of it is for (the architect, the security team, operations), as one would invite them; in the plan on screen and in the plan as text.
- The README shows the demo plan in its pictures, and names the readout of a proof of value among what it runs.
- New: `demoAudience` in `forward.js`, with a test; a browser check.

## 0.172.0

- **What leaves from a workshop is logged under the prospect.** A copy, a file or a mail drafted from a discovery workshop now goes in the log of what left the page under the prospect's name, as one from a customer's analysis does; Saved lists it, and erasing the prospect names it on the receipt.
- **The meeting's cards from the search.** With a workshop open, Search or jump to (Ctrl K) offers **Run the demo, card by card**, **Rehearse the objections** and **Go through the proof of value, criterion by criterion**: it opens the view and starts the deck.
- A browser check that the search starts a rehearsal.

## 0.171.0

- **Pseudonyms cover prospects too.** At the pseudonym level, the page replaced the names of the customer it had analysed, but not those of the prospects in discovery: a readout, a recap, a demo plan or a note from a workshop left with the prospect's real name. It now knows every prospect kept in this browser: the customer of each discovery workshop and each proof of value, and a proof's sponsor and champion as people (hidden at the people level too). The preview shows the alias before anything leaves.
- New: `prospectIds` in `aliases.js`, with a test; a browser check that a workshop's demo plan leaves with the alias.

## 0.170.0

- **Help answers three more presales questions:** how to run the demo and keep it on time, how to go through the results of a proof of value with the sponsor, and how to practise the objections before the meeting. Search (Ctrl K) finds them too.
- The presales and leaders guides name what did not land in the demos among what the deals teach.
- At the end of Run the demo, in the meeting's last five minutes, a line says it is time to close: agree what a proof would have to show, and who signs it off.

## 0.169.0

- **What did not land in the demos, across deals.** What the deals teach (on the presales desk, and the team's desk) now lists the parts of a demo that did not land, most often first, with how those deals ended: a part that keeps missing is a demo to change. A part is named by what it was to show (the gap it closes, or the concern it answers), never by what was said about it.
- Team snapshots may carry them (`missed` on a deal: the line and the part, at most twenty); snapshots from before stay readable. A snapshot that carries them is refused by versions before this one, as with every new field: update the app on both ends.
- Tests for both, and that what was said in the demo stays out.

## 0.168.0

- **Running the demo against the clock.** With the meeting clock running, each card of Run the demo says whether the demo is on time, from the plan's minutes: "On time: about 8 minutes for this part", "2 minutes behind: keep this part to its point, and say what you will send in writing", or ahead, with time for their questions. At the end, in the last five minutes: time to close, and agree what a proof would have to show.
- The length of the demo meeting sits on one line with its select.
- New: `demoPace` in `demo.js`, with a test; a browser check with the clock twenty minutes in.

## 0.167.0

- **The demo, timed.** The demo plan under The way forward now sets the length of the meeting (30, 45 or 60 minutes; the meeting clock's when it runs) and spends it: two minutes for their situation, three for the result, three for each concern they raised, five to close, and the rest shared among the gaps it closes, three to ten minutes each. What does not fit waits for the next meeting, the last gaps first, struck through in the plan; what is left over is said as time for their questions.
- The plan as text says the same ("A 45-minute meeting", "about 7 minutes each", "Not in 30 minutes: keep for the next meeting"), and the cards of Run the demo say how long each part has, leaving out the parts that wait.
- New: `demoTime` in `forward.js`, with tests; browser checks for the minutes at two lengths.

## 0.166.0

- **After the demo, a note for the customer.** At the end of the demo deck, and under How it landed, **Copy the note for the customer** gives the follow-up to send: what we showed, each beside what they told us in discovery; the concerns they raised, with how we propose to prove each; their questions, each with a line for the answer; and the proof of value we propose, to confirm on their own systems what landed. It names no reaction: what did not land, and what was said about it, stays in the recap for the account team. It leaves the page through the same check as every copy.
- New: `customerNote` in `demo.js`, with a test that nothing internal is in it.

## 0.165.0

- **The README says what the cards carry now:** the discovery questions, the deal's qualification, the demo built from what they said, and the readout of a proof of value, each ending with where it stands and a recap; and a concern recognised as it is said.
- **Rehearse the objections.** On Prepare, before the meeting: what the customer would say, one card each, the line to start with first and the ones they already raised first. Say your answer aloud, turn the card to check it (the question to ask first, the answer, how to prove it), and swipe right if you had it, left to practise it again. At the end, the ones to practise again; Prepare then says how it went. Nothing of it is kept: it lasts as long as the page is open.
- New: `REHEARSE`, `rehearseCards` and `rehearseSummary` in `deck.js`, with a test; a set of cards can now name the parts of the card's other side and its box. A browser check for a rehearsal from start to end.
- **The meeting guide shows the readout on a phone,** at its end: what was met, partly met and not met, with the evidence. `scripts/screenshots.py` takes it with the others.

## 0.164.0

- **The distance to the target, drawn on Today.** Under the number and its sentence, a bar shows what really works against the target's mark ("target 90%"), so the gap the name is about is seen before it is read. Pointing at an action shows, on the same bar, where it would take Yield, as it already did on the number and the stages. On a wide screen, the hero no longer leaves an empty middle beside Where it leaks.
- Screen readers hear it as one figure: "72.6%, 17.4 points below the 90% target".

## 0.163.0

- **A concern, recognised as it is said.** Written in **Heard something**, a sentence that voices one of the concerns the lines in scope expect ("we have backups already", "the DBAs will never give up control", "automation could break production") now shows that concern first, above the questions it answers: the question to ask before answering, the answer, and how to prove it. **Mark it raised** sends it, as on Prepare, to the customer readout, the demo plan and the proof of value; **Undo** takes it back.
- A concern is offered only when what was said covers most of its words (or four of a longer one): ordinary sentences, such as who signs or what a line costs, do not bring one up. Ctrl+Enter still files the first question.
- New: `concernCards` and `concernsHeard` in `heard.js`. Tests: twenty-two concerns said in other words are each recognised; every concern of every line finds itself; ordinary sentences find none. A browser check that one is recognised, marked raised and undone.

## 0.162.0

- **Email the recap passes the same check as a copy.** At the end of the questions, the demo and the readout, **Email the recap** was a link that opened the mail app with the text in it, around the check every other way out goes through. It is now a button: the subject and the text pass the sharing level first (names, people hidden or pseudonyms), with the same preview, and only what comes out of it opens as the draft. A mail drafted is kept in the log of what left the page, beside copies and files, and the erasure receipt names it.
- Nothing is sent by the page: the mail app opens with a draft, as before.
- A browser check that, with pseudonyms, the readout's mail shows the preview with the customer's alias and opens nothing until it is accepted; the mails of the questions and the demo are read where they would open.

## 0.161.0

- **The readout, criterion by criterion.** A proof of value's success criteria now open as cards, full screen, the same as the discovery questions and the demo: **Go criterion by criterion**, under Success criteria. One card per criterion still counted, starting at the first not tried, with how we will know on the back; swipe it by what was seen: right met, up partly met, left not met, down dropped (with the sponsor). The evidence is written on the card and suggests a result ("failed" sounds like not met, "two of three, the third next week" like partly); you decide.
- At the end: how many were met out of those counted, what was not met and what it means for the decision, what is only partly there, what was met with its evidence, and what is still to try. **Copy the recap** and **Email the recap** for the account team; **Mark the readout as held** closes the proof, so the way forward moves to the decision.
- Every result is kept on its criterion, as when it is set in the list: the result report, the mutual plan and the handover read the same.
- New: `site/readout.js`, with tests; browser checks for the readout from start to end.

## 0.160.0

- **Run the demo.** The demo planned from what they said, under The way forward, now runs as a deck, full screen, like the questions: one card per gap it closes ("Show that no administrator account can delete the backups", for the security team, with what they said in discovery on the back), then one per concern they raised. Swipe each as it landed: right landed, up questions, left did not land, down not shown; or tap, or press an arrow or 1 to 4. What they said is written on the card, and suggests a reaction ("how long does a restore take?" sounds like questions); you decide. The meeting clock follows.
- At the end, where it stands: how many parts landed out of those shown, the questions to answer in writing, what did not land (ask what they expected before planning a proof), what landed for the proof to confirm, and what was not shown. **Copy the recap** and **Email the recap** for the account team; **Mark the demo as given today** closes it.
- What follows from it:
  - under the plan, **How it landed**;
  - the way forward asks for it before the demo phase is done;
  - what landed goes into the proof of value as criteria, after the line's own, to confirm on their own systems;
  - the next meeting's agenda opens with **Back from the demo**: their questions, and what to show again, closer to their case. What they said where it did not land is not in the agenda.
- The reactions are kept in the workshop beside the day the demo was given (`demo.seen`), at most 16, each with what was said; giving or taking back the demo keeps them. Workshops exported before read as before.
- New: `site/demo.js`, with tests; browser checks for the whole run, the agenda and the proof.
- On a phone, the sharing menu in the header shows its whole label ("Names: shown") instead of cutting it.

## 0.159.0

- **Who to invite next.** At the end of the deck, where it stands now closes with **For the next meeting**: the people who can answer the essential questions still open (not answered, or nobody in the room knew), most first, each with one of their questions to say why. For example: "Invite the security team: 3 essential questions still open". The recap for the account team carries the same lines.
- New: `whoNext` and `inviteLines` in `deck.js`, with tests; a browser check that the end of the deck says who to invite.
- **Heard something on Qualify the deal too.** In a meeting one moves between the technical questions and the deal's; the box for what is said out of turn is now on both, above the ten questions here. It matches the same way, against every question in scope and the ten of the qualification, files with a tap or Ctrl+Enter, and can be undone. Filed here, the list, the card and the verdict follow at once.
- One piece of code serves both views (`heardPanel`), so the two cannot drift apart.
- A browser check that the box on the qualification finds the deal's question.
- A browser check that failed once in a while is steady now: the warning when a QBR draft is copied could be replaced by the next message before the check looked; every message the status line shows is now kept and read.

## 0.158.0

- **The meeting guide shows Heard something in use.** An animated picture recorded from the app on a phone, with the invented example: full screen, the sheet opened under the card, a sentence written as the customer said it, the questions it answers with the answer its words suggest, and a tap that files it, Undo beside.
- `scripts/deck_gif.py` records two scenes now: `--scene deck` (the default, for the README) and `--scene heard`.

## 0.157.0

- **The meeting clock follows to Qualify the deal.** In a meeting one moves between the technical questions and the deal's; started on the questions, the time left now shows in the header of the qualification card too, kept up to date, and goes when the clock is stopped.
- **Lighter while writing what was heard.** Each question's words are worked out once and kept, instead of at every key pressed, so matching stays quick on a phone with many lines in scope.
- A browser check that the clock shows on the qualification card.

## 0.156.0

- **Heard something, on every line.** Twenty more sentences, on the real questions of AI, cloud operations, endpoints, SaaS, service provider clouds and the platform itself, all find their question among the three offered, eighteen first. Examples: "people paste customer data into public chatbots", "half the VMs are oversized", "contractor laptops have no agent at all", "marketing bought their own tenant with a credit card", "plenty of powered-off VMs still sit on expensive disks". The matching learned:
  - a VM is a machine and a ticket a request;
  - a disk is storage;
  - switched off, powered off and turned off are one idea.
- With this, every product line and the deal have sentences checked on every build: 85 in all. On each set the right question is among the three offered for every sentence, and first for most.

## 0.155.0

- **Heard something, on platform migration, identity, logs and private AI.** Sixteen more things a customer might say, on the real questions of those four lines, now all have their question among the three offered, thirteen first. That was eight first and ten in the three before. Examples: "our hypervisor licence renewal is in March", "nobody has a rollback plan if the cutover goes wrong", "leavers keep their accounts for weeks", "some admins still log in without MFA", "we only keep logs for 30 days", "the GPU servers sit idle". The matching learned:
  - a hypervisor and a platform, a contract and a renewal, a licence however it is spelt;
  - a lab or a pilot as a test, something broken as something gone wrong;
  - a leaver and offboarding;
  - multi-factor and MFA;
  - signing in, logging in and a logon as one;
  - keeping and retaining;
  - a country as a matter of jurisdiction;
  - "out of their vendor's support" as out of support, an operating system as an OS.
- Every earlier phrase set keeps its results; the new sixteen are kept as tests beside them. In all, 65 sentences across the deal and fourteen lines are now checked on every build.

## 0.154.0

- **Heard something, on storage, edge sites and microsegmentation too.** Sixteen things a customer might say on the real questions of object storage, file storage, edge sites and microsegmentation now all have their question among the three offered, fifteen of them first. That was nine first and fourteen in the three before. The matching learned:
  - ransomware is its own word, no longer folded with any attack; an attack, a breach and a compromise fold together;
  - a machine, a server and a host are the same here;
  - travelling or driving to a site, and swapping or replacing a part, read as such;
  - bandwidth reads in Mb and Gbps;
  - old data and ageing data, tiering and archive, go together;
  - "out of support", "end of life" and "support ends" are one idea.
- The earlier phrase sets (databases and clouds, Kubernetes and virtual desktops, disaster recovery, the deal) keep their results; the new sixteen are kept as tests beside them.

## 0.153.0

- **A recap for the account team, from the end of the deck.** Where it stands now offers **Copy the recap** and **Email the recap**: plain text with how many questions were asked and how each was answered, the real gaps and what nobody could answer with what the customer said, and what would need to be true. Email opens the person's own mail app with it written in (no server sends anything); it is kept short enough for any mail app. It names the gaps, so it is for the team, not the customer: the customer readout is the page for them.
- New: `recapText` and `recapMailto` in `deck.js`, with tests; a browser check for both on a phone.

## 0.152.0

- **Heard something, checked on Kubernetes and virtual desktops.** Twelve more things a customer might say, on the real questions of those two lines among the platform and disaster recovery ones ("every team spun up its own clusters", "everything is kubectl by hand", "logons take five minutes every Monday", "the antivirus inside the desktops eats half the CPU"), each find their question first. They are kept as tests, beside the nine of 0.151, so a change to the matching that makes any of them worse fails the build.

## 0.151.0

- **Heard something understands more of how people talk about databases and clouds.** Measured on the real questions of four lines (platform, databases, disaster recovery, hybrid cloud), nine things a customer might say now all have their question among the three offered, six of them first:
  - a database is also a DB, an instance or a schema; production is prod; a copy can be a clone;
  - "failing over" and "failing back" read as one word; "point in time" is one idea;
  - a bill and an invoice, egress and outbound traffic, a fee and a price, a jurisdiction, sovereignty and GDPR each fold together;
  - short words that carry meaning here (DB, VM, OS) are kept.
- New tests on those nine sentences against the real questions, so the matching cannot quietly get worse.

## 0.150.0

- **A page for the hour with the customer: [Running a discovery meeting](docs/meeting.md).** Before (the workshop, who is in the room, most useful first, the card's other side), during (the meeting clock, writing what they said and swiping, heard something for what is said out of turn, full screen, the qualification on cards), after (where it stands, the journey, the summary and the readout, the way forward), and what it is not: no recording, no transcript, no model in the cloud. Linked from the README, the workshop guide and the presales guide.

## 0.149.0

- **The first card says it can be swiped, without a word.** The first card a browser shows leans right, then left, once, with the answer each way faintly stamped on it, then settles. Never twice, never while it is being dragged, and never when the device asks for reduced motion.
- A browser check that the hint is shown once and remembered.
- The screenshots and the README's animation are taken again from this version.

## 0.148.0

- **The card says what an answer puts on the journey.** Answered anything but solved, the next card opens with one line, "On the journey:", and the condition that would now need to be true ("The cost of a day without the main site is known and agreed"), read out to a screen reader with the answer. The deck and the journey are one piece of work, and now it shows while asking.
- **The back of the card has the way forward too:** after why it matters, what to listen for and what to ask next, what would need to be true and a first step towards it, so a gap can be answered with a next step in the same breath.
- A browser check that a real gap says what it puts on the journey.

## 0.147.0

- **Heard something sits right under the clock**, before the progress and the strip of lines: the two things used while the customer talks are together, and on a phone the box is just under the card.
- **Ctrl+Enter files it.** On a keyboard, what was heard is filed under the first match with the answer its words suggest, without leaving the box; when nothing is suggested, it says so and waits for a tap. Undo works the same.
- The browser check on a phone now files what was heard with the keyboard.

## 0.146.0

- **Heard something about the deal? It finds the qualification question too.** The same box beside the card now matches what was said against the ten qualification questions as well as the technical ones. "The CIO signs off anything above 500k" goes to who decides and signs, "our contract expires in March" to the date that forces a choice, "they are also talking to another supplier" to what else they weigh. A match there offers **Known**, **Partly** or **Not yet**, files it in Qualify the deal with the words as its note, and can be undone.
- The matching knows more of a deal's words: signing and approving, deciding and choosing, a supplier and a competitor, carrying it inside, a renewal and an expiry, procurement and legal.
- Tests for the deal's questions found from what was heard, the technical ones still finding theirs; a browser check for a qualification match and its three answers.

## 0.145.0

- **The first screen of a pre-sales engineer starts with a new prospect.** A prospect has no exports to drop yet, so with **Pre-sales engineer** chosen under "I work as", **Start a discovery workshop** and the filled-in example come before the customer's files, marked out, and the desk is in the menu as before. Other roles see the page as it was.
- A browser check that the workshop comes first for a pre-sales engineer.

## 0.144.0

- **What could stop a deal, one block per prospect.** On the presales desk the risks were a long column of near-identical cards, each with its own badge, red edge and Open button, the same prospect several times over; on a phone, screens of it. Now each prospect is one block: its name, how many risks can lose it on their own and how many to watch, its risks as short lines (a red dot for those that can lose it, read out to a screen reader), and one Open. The prospects with the most to lose come first, and none is cut off.
- A browser check that the blocks are one per prospect, the one with most to lose first.

## 0.143.0

- **The README shows the deck in use.** An animated picture recorded from the app on a phone, with the invented example workshop: what was said written on a card, the answer it suggests, a swipe with the answer stamped on the card, and the next cards answered. Beside it, what the deck does in a meeting.
- New: `scripts/deck_gif.py` records it again from a built site (it needs ffmpeg): `python3 scripts/deck_gif.py <site> docs/img/deck.gif`.

## 0.142.0

- **A figure heard goes with the answer.** When what was heard holds money ("about 2 million euros", "€40,000 per hour", "500k each outage") and it answers a question about value, the match shows the figure it read and what it is counted per. Filing it puts that figure on the question too, where the case for change and the journey read it. The period is the one said ("a day", "per hour", "each outage"), else the one the question asks about ("one day without your main site"). A bare small number is not money ("three years ago", "2 ms", "300 VMs"), nor is a year; with nothing to say what it is counted per, no figure is offered. Undo puts the earlier figure back.
- New: `figureIn` in `heard.js`, with tests; a browser check that the figure is read on the value question it answers.

## 0.141.0

- **Undo, after heard something.** In a meeting a tap can land on the wrong question. Filed, the line under the box now offers **Undo**: it puts back what that question had (its answer and its note, or nothing), returns the words to the box with their matches, and moves the card back in step.
- **The deck's keys are in the list of shortcuts** (the ? key): the arrows on a question card, and 1 to 4 on a card or a question in the list.
- A browser check for undo on a phone.

## 0.140.0

- **Heard something, full screen too.** On the whole screen the deck had only the card: something said out of turn meant leaving it. **Heard something else?** now sits under the card as a sheet: open it, write what was said, and file it under the question it answers. The card moves on if it was the one answered. Closed, the box is back beside the card in the page, with nothing lost.
- Browser checks for the sheet full screen, its matches, and the box back in its place.

## 0.139.0

- **Fixed: "Your first minute" on Today sat over the page.** The three first steps shared a class name with the guided tour, which floats over the page, so on a phone the card hung at the top of the screen, half under the header, over the customer's numbers. It is a card in the page again, as meant.
- **Fixed: Partners was ten pixels wider than a phone.** The route to purchase put its label and its choice side by side; on a phone the choice goes under its label and stays within the screen, and the bar at the bottom no longer slides out of view.
- **A stricter check on width.** The browser check measured a page against a window that grows with it, so an overflow could never show. It now measures against the phone's own width, on every customer view and every workshop view.

## 0.138.0

- **Fixed: the bar at the bottom of a phone before a customer is open.** The Lavagna layer had given Start, Saved and Help rounded corners and made the current one see-through, so the page showed through the bar on the very first screen. On a phone they are a solid bar again, the current place marked by a line on top.
- **Fixed: Presales desk on that bar.** With the desk among the places (the presales role, or everything shown), it sat on top of Start: the bar had room for three. Four now share it, a quarter each.
- A browser check keeps the bar so: fixed at the bottom, square, opaque, and each place reachable where it is drawn.

## 0.137.0

- **Most useful first: the card asks what matters most now, and says why.** A new filter, **Most useful first**, orders the card (the list keeps its order):
  - the questions not answered come first, the essential ones before the others;
  - then those of the lines known least, where most questions are open or were answered "nobody knows", and of the lines nothing was asked on yet;
  - the card carries the reason: "Nothing asked on this line yet" or "Least known line".
- At the end of the discovery deck, **Write the meeting summary** is one tap away, beside the journey.
- On a phone that can, a swipe that answers gives a short buzz.
- New: `bestFirst` in `deck.js`, with tests; a browser check that most useful first starts on an essential question of a line nothing was asked on.

## 0.136.0

- **Qualify the deal on a card too.** The ten qualification questions open as the discovery questions do: **Find out next** shows the first one not answered, with room to write what they said.
  - Swipe it right if it is known, up if partly, left if not yet, or tap the answer. The keys are the arrows and 1 to 3, and **Full screen** gives the card the whole screen.
  - Beside the card, the compact list of the ten. An answer given in one shows in the other at once, and the verdict above follows.
  - Words that say nobody is sure ("not sure", "no idea") suggest **Not yet**; "some", "only", "partly" suggest **Partly**.
  - At the end, where the deal stands: the verdict and its score, what is not yet known and what only partly, with what was said, and the way forward one tap away.
- **One deck for any set of answers.** The deck now takes its answers as a set laid on the four directions: four for discovery, three for qualification. The order, the keys, the swipes and the summary come from the set (`answerSet`, `tally` in `deck.js`, with tests).
- The card's column keeps its ground the whole height of the panel when the list beside it is taller.
- Browser checks for the qualification card: the first question not answered, its three answers, and an answer on the card showing in the list.

## 0.135.0

- **A meeting clock, and whether the essential questions still fit.** Beside the card of the next question, 30, 45 or 60 minutes start with a tap.
  - It shows the time left in large type, and on the card's header too, full screen included, so the time is in view while asking.
  - A bar shows the essential questions asked against a mark for the time gone. A line says it plainly: "On pace: 7 essential questions left, 30 minutes to go", "Behind: 6 essential questions in 15 minutes, about 2 minutes each", "Over time, with 2 essential questions still open: agree a follow-up before you leave", or "Every essential question is asked".
  - Behind, **Ask only the essentials** narrows the list and the card to them in one tap.
  - "Nobody knows" counts as asked. The first minutes go on introductions, so ten points behind the time is still on pace.
  - The clock is the meeting's, not the customer's. It stays in the browser tab (it outlives a change of view or a reload) and is never saved in the workshop or in a file. **Stop** clears it.
- New: `pace.js` (the reading and the pace, with tests); browser checks for starting the clock, the time on the card, the clock after a change of view, behind with the essentials one tap away, and stopping it.

## 0.134.0

- **Heard something? Write it as it was said, and the app finds the question it answers.** Beside the card of the next question, a box takes what the customer said out of turn.
  - As you write, the best three questions it answers are offered, from every question in scope. Each shows its line, whether it has an answer already, and the four answers, the one the words suggest lit.
  - A tap files it: the answer, and the words added to that question's note, never over what was written before. The card, the list, the strip and the progress follow.
  - The matching weighs the words of each question twice and what to listen for, why it matters and the follow-up once, rare words more than common ones. It folds words that mean the same here: a backup and a copy, a restore and a failover, a data centre and a site, a round trip and milliseconds, a recovery point and an RPO. It runs in the browser, and nothing leaves it.
- New: `heard.js` (the words, the matching and the note, with tests); browser checks for the matches and their suggested answer on a computer, and on a phone for filing what was heard under its question with the words as the note.

## 0.133.0

- **The questions open on the card of the next question.** The deck of 0.132 was behind a button; now it is the first thing in the questions of a workshop, in the page:
  - the next question to ask, as a card, with room to write what they said and the four answers under it;
  - beside it on a larger screen (under it on a phone), the progress and a strip of every line with a dot per answer;
  - the list of every question follows, as before, with the same answers.
- **Swipe in the page:** left for a real gap, right for solved; on a touch screen a drag up or down scrolls the page. **Full screen** opens the same deck on the whole screen, where it was, with all four directions.
- **The card follows the meeting:** an answer given in the list moves it on to the next question still open, and the filters (essential only, who is in the room, not answered yet, asked by the tender) reshape it.
- At the end of the deck, **Ask what is still open** goes back to the first question skipped.
- New screenshot `app-nextcard.png`, in the README and the workshop guide; browser checks for the card at the top, Full screen where the card was, and the card at the top on a phone.

## 0.132.0

- **One question at a time: the discovery questions as a deck of cards.** **Ask one at a time**, at the top of the questions, opens the questions shown as a deck, full screen on a phone and a card in the middle of a larger screen.
  - It starts at the first question with no answer and follows the filters of the meeting: essential only, who is in the room, not answered yet, asked by the tender.
  - **Each card has room to write what they said**, saved with the answer as the note the list already keeps.
  - **Swipe to answer:** right for Solved, left for A real gap, up for Partly, down for Nobody knows. The answer the card is heading for is stamped on it while it moves. The buttons under the card, the arrow keys and 1 to 4 do the same.
  - **The words suggest the answer:** "never tested" sounds like a real gap, "some of them" like partly, "not sure" like nobody knows. On a question a yes answers badly ("could an administrator delete your backups?") the reading turns round, and a round trip under about five milliseconds reads as solved. The suggestion lights a button and never answers on its own. It is a few word patterns read in the browser; nothing leaves it.
  - **How to ask it** turns the card over: why it matters, what to listen for, what to ask next. Previous goes back to a card and its answer; Skip leaves one for later.
  - **At the end, where it stands:** how many of each answer, the gaps and the unknowns with what was said, and the journey one tap away. Closed, the list, the strip and the progress show what the deck answered.
- With lines in scope, the progress and the way to ask come before the meeting's settings, which on a phone are a long scroll.
- New: `deck.js` (the order, the gestures, the keys, the suggestion and the summary, with tests); browser checks for a swipe, a key, Previous, the note in the list, the deck on a phone and its summary, and an accessibility audit with the deck open, light and dark. A new screenshot, `app-deck.png`.

## 0.131.0

- **The phone, made for a thumb.**
  - **The bar at the bottom carries the views of what is open:**
    - Questions, Qualify and Tender in a workshop (before, it held only Menu);
    - Today, Actions and Call for a customer, as before;
    - Estate and Grow for an estate;
    - This week for a book.

    It is light like the board, with the current view marked in blue.
  - **A view's introduction shows two lines**, with More for the rest; Pin to menu stays on larger screens.
  - **The discovery questions:**
    - the four answers share one row of equal buttons instead of breaking over two;
    - the filters of the meeting are one row each, swiped sideways, instead of a column of buttons.
  - **Wide tables slide sideways** instead of being cut at the edge, with readable columns and a shadow on the edge that has more: waves, recovery, edge, cost per machine and the others. The tables of records keep reading as cards.
  - **The page uses the width:** smaller margins and card padding.
  - A sketch whose table is wide no longer widens its card past the screen.
- New browser checks on a phone: a workshop's bar, answers that fit the screen, More on a long introduction, no workshop view wider than the screen.

## 0.130.0

- **A new look: the whiteboard session.** The whole app restyled, the same everywhere:
  - a board-white ground with a heavy marker rule under the top bar, and a light menu in place of the dark one;
  - marker colours that mean something: blue for structure, red for a gap, green for solved, ochre for partly;
  - headings in Bricolage Grotesque, heavier and tighter; the text stays in Atkinson Hyperlegible;
  - flat panels without shadows; switches and chips filled with ink when on;
  - **a chosen answer is circled by hand**, in the colour of what it means, wherever answers are given: discovery, qualification, bid or no bid, tender requirements;
  - verdicts are highlighted as with a marker instead of boxed; lists that matter (risks, what to keep an eye on, the journey's conditions) are flat rows with a mark in the margin;
  - the one number that matters (the score, the estate, the journey, the desk) is written on a blackboard panel.
- The dark theme follows: the board at night, with the same marks.
- Every colour passes the accessibility audit (4.5:1 for text) in both themes.

## 0.129.0

- **Qualify the deal, shorter.** The third view on the compact pattern:
  - the ten questions come first, grouped as a deal is won: why they would buy, how they decide, how we win it, each group a tile with a dot per question;
  - each question is one line: its tag, what was heard or, until then, the question itself, and the answer in line;
  - opened, a question shows all of it, why it matters, how to ask it and the note of what was heard; the keys 1 to 3 answer it and open the next one still open;
  - filters: all, not answered, partly or not yet.
- **What else they weigh** follows the ten questions; the introduction is no longer repeated in the card.

## 0.128.0

- **The discovery questions, shorter.** The second view redone on the compact pattern of bid or no bid:
  - each question is one line, its four answers in line, with **Essential** and **in the tender** marked;
  - a question opens on its own, one at a time, for its stage, who to ask, why it matters, how to ask it, what the tender asks, and the note of what they said; Escape closes it;
  - closed, an answered question shows what they said and the figure in one line; a question their inventory already answers shows what it says;
  - a strip shows every line in scope, with a dot per question coloured by its answer; a tile opens its line;
  - **Not answered yet** joins the filters of this meeting.
- The keys keep working as before: 1 to 4 answer the selected question and select the next one. Opened, an answer leaves the cursor in the note.
- **The lines in scope** read as one line in the meeting card; the whole choice of about twenty lines opens on demand, and is open while none is chosen.
- The page puts the conversation first: the meeting, where each line stands, the filters, the questions. The sketches from their numbers (inventory, sizing, waves, GPU, disaster recovery, object storage, edge, cost per machine) follow, under their own heading.

## 0.127.0

- **Bid or no bid, shorter.** The first view redone as a compact list of questions, the pattern the questions of discovery and qualification will follow:
  - a tile per group (can we take part, can we win, is it worth it, can we deliver) counts its answers with a dot each, and narrows the list to that group;
  - filters: all, not answered, partly or no, with their counts;
  - each question is one line, with a short name, what was read from the tender, and the answer in line;
  - opened, a question shows all of it and why it matters; the keys 1 to 3 answer it and open the next one still open, Escape closes it;
  - the team's call sits on one line under the list.
- On a phone, the group tiles sit two per row and each question's answers go under it.

## 0.126.0

- **Bid or no bid.** A review of whether a tender is worth answering, in the tender's page. Eleven questions bid teams ask, in four groups: can we take part, can we win, is it worth it, can we deliver.
  - Four are read from the tender unless answered by hand, each saying what it read: the mandatory requirements, the time left, price and quality, the partner leading the deal.
  - Three can exclude the bid: the bidder's standing, the mandatory requirements, the contract terms.
  - **The review advises:** do not bid (naming the question that excludes it), find out first, think twice, or bid (naming what is against it).
- **The team's call,** kept apart from the advice: we bid or we do not bid, dated, with why.
  - Not bidding takes the tender off the desk's risks and agenda, the way forward and the next meeting.
  - **Do next** then offers a short, polite letter declining it, to adapt.
  - **Tenders in progress** shows it as not bidding.
- The tender's header says where the review stands. A no that excludes the bid, other than a mandatory requirement, leads **Do next**.
- **Copy for the bid review** gives the review in Markdown; the bid summary carries it.
- The invented public tender on the desk has a review half done.
- Stored with the tender and checked field by field on the way in; it never reaches the customer readout.

## 0.125.0

- **What wins it: price and quality.** For a tender awarded on the best ratio of quality to price, a new card compares our bid with the rivals' guessed ones.
  - **How the tender scores:** the points for quality and for price, and how price is scored, among five formulas public procurement platforms publish for contracting authorities:
    - lowest price over each price;
    - each discount over the largest;
    - two slopes around the average discount (X of 0.80, 0.85 or 0.90);
    - the discount over the largest, to a power below one;
    - from the dearest to the cheapest.

    Plus the base amount, and whether quality is rescaled so the best bid gets every point.
  - **Our bid:** the price, and the quality points, typed or read from the scored requirements as answered.
  - **The rivals, guessed:** up to four.
  - **What it says:**
    - a bar per bid, quality and price stacked, the highest total first;
    - who comes first and by how much;
    - the price at which that changes, or that the gap is in quality when half our price would not close it;
    - what one point of quality is worth in price;
    - a warning for a price above the base amount, or far below the rivals'.
  - **Copy for the bid review** gives it in Markdown; the bid summary carries it.
- **Do next** lists a rival ahead on price and quality, with the price that would change it.
- **Tenders in progress**, on the desk, says where each bid stands on price and quality.
- Stored with the tender and checked field by field on the way in; it never reaches the customer readout.

## 0.124.0

- **Tenders in progress, on the presales desk.** Every tender kept in this browser, the nearest deadline first:
  - whether the bid can go ahead, with who issues it;
  - a bar of the answers (met, partly, not met, to check) and how many are answered;
  - the next deadline, questions or bid, with the days left; a past one shows as late;
  - **Open the tender** opens it where the bid stands.
- **A message for whoever still owes answers.** Next to who still owes answers, **Copy for the partner** (or a specialist, the product team, commercial and legal) gives a message ready to send:
  - that person's requirements still open or to check, numbered, with mandatory or points;
  - what has been written so far for each;
  - the date to answer by, three days before the next deadline.
- **The invented examples** now include a public tender, half answered, with a mandatory requirement not met and the questions due in four days. It shows on the desk, in the agenda, among the risks and in Tenders in progress.

## 0.123.0

- **The technical response.** Generated from the tender itself, section by section as the tender numbers it (2.3.1 in section 2, RT-05 in RT).
  - Each section is named after the line most of its requirements ask about, until the bid team types the tender's own title.
  - Each requirement appears quoted, with mandatory or points, the answer as a coloured label, how it is met, and what is attached.
  - The attachments are listed at the end.
  - It downloads as a page to print or save as PDF, or as Markdown. The page has a cover, contents, highlighted square brackets, every text escaped, no scripts, and its own security policy.
- **Before it leaves.** The delivery card checks the response; each item is passed or carries the button that fixes it:
  - every requirement answered;
  - every met or partly answer says how;
  - nothing left in square brackets (the new chip **To fill in**);
  - no other customer named in an answer reused from another tender;
  - the pages it takes against the tender's page limit.
- **Do next** puts an answer that still names another customer right after what could exclude the bid ("Open the first"), and counts the answers with square brackets to fill in.
- Stored with the tender, and checked on the way in: the page limit and the section titles.
- **Fixed:**
  - pressing the answer keys faster than an answer was kept could take the previous answer back. A key now never takes an answer back (a click does), and keys pressed while an answer is being kept are ignored.
  - the small bars by line showed only their first colour: a class name clashed with an older one.

## 0.122.0

- **Tender requirements, redesigned** to answer a long tender quickly, and to see at a glance where the bid stands.
  - **Where the bid stands:**
    - two bars, mandatory and scored, coloured by answer, with a legend of the counts;
    - the points likely won and the deadlines;
    - **Do next:** at most three things, most urgent first, each with the button that does it. For example: a mandatory requirement not met, questions due within a week, mandatory requirements still open, answers that do not say how.
  - **A compact list,** one row per requirement: reference, text, mandatory or points, line, "no note" when it is unexplained, and the answer as a coloured pill. Opening a row shows everything about it.
  - **The keys 1 to 4** answer, and the next requirement still open opens by itself, as in a meeting. Escape closes it.
  - **Finding your way:**
    - chips with counts, including "not explained";
    - a search by words or reference;
    - a line to pick;
    - **Group by line**, with a small bar per line and the lines in the conversation first.
  - **The page follows the work:** load the tender (the loader folds away once requirements are in), answer, deliver.
  - **Deliver the bid** shows, side by side, the coverage by line, the questions for the contracting authority as drafted, and the evidence to gather.
- New pure functions in `rfp.js`, all tested in Node: `nextSteps`, `filterCounts`, `keepReq`, `matchesSearch`.

## 0.121.0

- **The answer kit for tenders.** Neutral answers to the typical requirements of each line, and of any line. Each comes with the evidence to attach and what to check before using it; square brackets mark what to fill in for the customer. 33 answers cover:
  - the platform: node failures, upgrades without stopping, moving running machines, growing the cluster;
  - recovery: recovery points and times, copies nobody can delete, test failover, recovery plans, retention;
  - object storage and file storage;
  - cloud operations, edge sites, desktops, migration, Kubernetes, AI, databases, segmentation and providers;
  - for any line: data residency, certifications, training, support and service levels, encryption and keys.
- **In tender requirements,** each requirement without a note offers:
  - the kit's answer;
  - the note written for the most similar requirement in another tender in this browser ("answered before", with the customer and the date).

  **Use it** puts it in the note to adapt. **Use the kit's answers where there is no note yet** fills every empty note at once.
- **The evidence to gather:**
  - a column in the compliance matrix;
  - a section of the bid summary, with the requirements each item backs.
- **Outside the page:** `beyond90 answers --profile <line>` (Markdown or JSON), and a read-only assistant tool, `tender_answer_kit`.

## 0.120.0

- **The tender meets the conversation.**
  - **Read from a file:**
    - a tender's workbook (.xlsx), read by the engine in the page; the sheet with the requirements is found, and header rows, Italian ones included, are skipped;
    - a CSV, whatever its delimiter;
    - plain text.
  - **Linked to the discovery questions.** Each requirement leads to the question of its line it touches most, by shared words weighted by rarity (two at least; none is forced). In the questions:
    - "The tender asks" shows under each question a requirement touches;
    - **Asked by the tender** narrows the meeting to those questions.
  - **Who issued it.**
    - A public body takes questions only through the formal channel, so nothing of its tender goes on a meeting agenda.
    - A company's requirements marked to check go on the next meeting's agenda.
    - Until it is said, nothing does.
  - **Matched on:** each requirement shows the words that pointed it at its line.
- Spreadsheet columns that say whether a requirement counts read more wording: obbligatorio, requisito minimo, migliorativo, premiante, preferenziale, valutabile.
- The engine reads any workbook as rows for the page (`workbook_rows_json`), with the same caps and refusals as the customer's workbooks.

## 0.119.0

- **What else they weigh, line by line.** Each line in scope adds the alternatives particular to it, grouped under its name in qualification:
  - disaster recovery: keeping the backup product, or recovery as a service;
  - object storage: a public cloud, or a backup appliance;
  - file storage: keeping the file servers, or shares in a public cloud;
  - databases: managed databases in a public cloud, or scripts and the DBA team;
  - Kubernetes: a managed service in a public cloud, or building it from open-source parts;
  - AI on own infrastructure: AI services from a public cloud, or waiting;
  - desktops: desktops as a service, or laptops and nothing central;
  - microsegmentation: firewalls and VLANs in the network;
  - cloud operations: the tools already in place plus scripts;
  - edge sites: a server per site, or running the sites from the cloud;
  - a service provider's cloud: reselling a public cloud.

  Each has the same parts: why, what to ask, when the proposal fits, when the other choice is the better one, how to prove it. Ids are unique across the file, so a workshop keeps them side by side. `beyond90 alternatives --profile` and the `what_else_they_weigh` tool return the line's own list after the family's.
- **Tender requirements:** "Where the bid stands" says who still owes answers (presales, a specialist, the partner, the product team, commercial or legal) and how many nobody has been asked yet. The bid summary lists the same.
- `docs/profiles.md` describes the alternatives file.

## 0.118.0

- **Tender requirements**, a new view in the discovery workshop: a tender or a request for proposal answered requirement by requirement.
  - **Paste** the requirements as they are in the document: numbered lines (continuations joined), bullets, or rows copied from a spreadsheet. Each is read as mandatory or scored, with its points when the text gives them, from wording in English, Italian, French, German and Spanish. When nothing says, it counts as mandatory.
  - **Matched** to the product line it asks about, from its words in English and in the wording of Italian tenders; the platform line yields to a more specific one. Correct either in one click.
  - **Answered:** met, partly, not met or to check, with how it is met and who answers.
  - **Where the bid stands:**
    - whether to bid: a mandatory requirement not met can exclude it;
    - the points sure, likely and at best;
    - the deadline for questions and the bid's due date;
    - the lines the tender asks about that the conversation has not covered, added in one click.
  - **For the bid:**
    - the compliance matrix (.csv, formulas defused);
    - the bid summary (.md);
    - the questions for the contracting authority, drafted: whether an equivalent is accepted, or what is expected.
- **On the presales desk:**
  - a mandatory requirement not met is a risk that can lose the deal;
  - so are questions due within a week with requirements to raise, and a bid due within ten days with requirements open;
  - both deadlines go in the agenda.
- **On the way forward,** the decision waits until every mandatory requirement is answered and none fails.
- **In the handover to delivery:** "What the bid committed to", the mandatory requirements answered met or partly, with how.
- **Help** answers how to answer a tender and what to do when the customer also weighs other options. The glossary adds compliance matrix and contracting authority.

## 0.117.0

- **What else they weigh.** The alternatives a deal is measured against, for the family of the lines in scope. For infrastructure:
  - renewing the current platform;
  - moving everything to a public cloud;
  - another hyperconverged or private-cloud platform;
  - separate servers and storage arrays;
  - building it with open-source virtualisation;
  - doing nothing for now.

  Each one gives:
  - why customers consider it;
  - the questions to ask;
  - when the proposal fits;
  - when the other choice is the better one;
  - how to prove it.

  They are written to be fair, and name no vendor.
- **In qualification,** the customer's alternatives are marked as on the table. What is marked:
  - goes into the meeting summary;
  - adds a check before the decision on the way forward;
  - counts in what the deals teach, with how often those deals were still won, on one desk and across a team;
  - on the presales desk, doing nothing with no date that makes the deal urgent is flagged as a risk that can lose it.
- **Outside the page:** `beyond90 alternatives --profile <line>` (Markdown or JSON), and a read-only assistant tool, `what_else_they_weigh`.
- The invented examples weigh renewing, a public cloud and keeping the arrays, so the lessons show it.

## 0.116.0

- **A first edge design**, in the discovery workshop when edge and branch sites are in scope. It works kind of site by kind of site, up to four standard designs, and gives:
  - the servers each site needs for its load and for the failure it must ride through;
  - the witness the two-server sites need;
  - whether the daily copy to the core fits the night over each link;
  - how long a whole site would take to come back over its link;
  - the upgrade waves: a pilot of one site of each kind, then waves of the agreed size;
  - what trips to sites cost today.

  Notes hold whatever the product.
- **What one machine costs**, when cloud operations, a service provider's cloud or hybrid cloud is in scope. A year of the estate, in the customer's figures:
  - hardware written off;
  - licences and support;
  - power and space;
  - the people who run it.

  It is divided among the machines running, typed in or taken from the inventory. Beside it:
  - what idle machines do to the cost;
  - a comparable machine in a public cloud;
  - for a provider, what a standard tenant costs and the margin its price leaves.

  "Copy for finance" gives the table and the arithmetic.
- Both are kept with the workshop, checked on the way in like everything else, and carried into the meeting summary and the handover to delivery.

## 0.115.0

- **Three more infrastructure lines**, each with its discovery questions (who to ask, what to listen for, what to ask next), proof-of-value criteria with how to test them, readiness items, a story for each audience with four objections, and an invented example customer:
  - `cloud-operations`, **cloud operations and self-service**: capacity forecasts with a run-out date, alerts on unusual behaviour, runbooks instead of scripts, a self-service catalog with quotas, cost per team, and posture checked against a baseline.
  - `edge-sites`, **edge and branch sites**: sites deployed without IT staff, upgraded remotely in waves, restored locally with the link down, replicated to the core, and room for AI at the edge.
  - `service-provider-cloud`, **a multi-tenant cloud for service providers**: tenants isolated by construction, their own networks with overlapping addresses, self-service within quotas, onboarding by workflow, metering to billing, and tenants moving in from another platform.
- The estate map and "where to grow" know them. Links say why one line leads to the next: a platform run by hand caps how many clusters one team can look after; data that cannot leave a site needs its inference to run there; a provider leaving a platform has tenants to move.
- The discovery workshop has three new starting points:
  - running it like a cloud;
  - shops, plants and branches;
  - a service provider's cloud.
- The start page has a demo for each of the new lines.

## 0.114.0

- **Help knows presales.** A new "Presales" group of answers covers:
  - the questions for a thirty-minute first meeting;
  - whether a deal is real;
  - what to do next with a prospect;
  - where a partner goes;
  - how to show a manager the pipeline.

  The glossary adds essential question, qualification gate, deal registration and route to purchase. The answers can be found from the command palette.
- **Partners across the team.** A desk snapshot carries the lead partner's company name and the end of its registration. In the team view, the manager sees:
  - each partner across the team;
  - the engineers it works with;
  - its live deals, wins and losses;
  - the registrations to act on, as of each snapshot.

  The team review carries it as a table. The other partners on a deal stay on the engineer's desk.
- The README says what the discovery workshop now does: how to ask, qualification, the way forward.

## 0.113.0

- **How to ask, wherever the questions are.**
  - `beyond90 discovery` gains `--essential` and `--role` (repeatable), and prints who to ask, what to listen for and what to ask next.
  - The account view's "Questions to ask" shows the essential questions and who to ask, with "How to ask it", and its copy carries both.
  - A new read-only MCP tool, `discovery_questions`, gives an assistant the same list, narrowed to the essential questions or to one role.

## 0.112.0

- **One picture of each deal, everywhere it goes.**
  - Each prospect on the presales desk says who it is sold with and the phase it is in on the way forward.
  - The agenda lists the day a partner's deal registration runs out, next to the dated conditions and the proofs of value.
  - The Monday note says who each deal is sold with and how far it is qualified.
  - The pipeline CSV gains the partner, its kind, the route to purchase, the end of the registration, the qualification and the phase.
- **The handover says who delivers:** who deploys and who supports, each partner and its skills, and the lines to line up before go-live.
- **What the deals teach** adds what the deals not won had not established (for example, the economic buyer never met), and how deals ended by route to purchase and by the kind of partner leading them.
- **The team view** reads the route to purchase, the kind of partner and the qualification from each engineer's snapshot. It shows how many open deals each engineer has qualified for a proof of value, and what the team's deals not won had left open. The new fields are optional, so older snapshots stay readable, and each is checked against its fixed list. Partner names are not a field.
- The invented won and lost deals carry their qualification, so the lessons show it at once. The screenshots are refreshed.

## 0.111.0

- **Partners on a deal.** Under "The meeting", **Partners** records:
  - the partners working a deal, up to four: reseller, systems integrator, service provider, distributor or consulting partner;
  - which one leads;
  - the deal registration and when it runs out;
  - the lines each partner has skills on;
  - the route to purchase: direct, reseller, distributor, public framework or marketplace, or as a service;
  - who does what from discovery to support: us, the partner or together.

  It says what to settle:
  - a registration that has run out or runs out within two weeks;
  - no registration;
  - discovery, the proof or the deployment owned by nobody;
  - a partner asked to deliver lines it has no skills on;
  - no route set.
- **A brief for the partner and a discovery kit for partners.** The brief carries:
  - who does what;
  - where the customer stands and what a proof would have to show;
  - the concerns raised;
  - what the deal still needs and the skills to line up.

  It includes the customer's words only when asked. The kit holds no customer's data, so it can go to any partner. For each line in scope it has the essential questions with how to ask them, the objections with answers and proof, the proof criteria and the proof's first-day checklist, then the ten qualification questions.
- **The partner review on the desk.** **Partners across your deals** shows each partner's live deals, the ones it leads, registrations to renew or file, wins and losses, and skills to line up, with a review to copy. A registration about to run out is a risk on the deal.
- **The way forward** asks, when a deal has partners:
  - that the registration is in place;
  - who runs the proof with them;
  - that delivery has an owner with the skills.
- The example prospects are sold with an integrator, a distributor and a service provider. The question helpers moved to their own module.

## 0.110.0

- **The desk's next step follows the way forward.** With nothing late and nothing dated, a prospect's next step on the presales desk is the first thing still to do in the phase it is in. For example, "Demo built for them: plan it from what they said, under The way forward". The Monday note and the CSV carry it.
- The screenshots show the questions narrowed to a first meeting, qualifying the deal, the way forward and the demo plan.

## 0.109.0

- **The way forward.** Each prospect is placed on the path from discovery to handover: discovery, a demo built for them, proof of value, decision, handover to delivery. Each phase says:
  - what it is for;
  - what must be true to move on, read from what is recorded, each with what to do and a link to where to do it;
  - how to run it and what to avoid.

  The phase now is the furthest one started. A phase passed with something still open says so.
- **The demo, built from what they said.** The last thing first:
  - their situation in their words and figures;
  - the result they want, shown first;
  - only the gaps on the line to start with, each with who it is for;
  - the concerns they raised, with how to prove each;
  - the proof to agree at the end.

  What they already have is listed to leave out, with a fifteen-minute version for the executive. Copy or download the plan, and mark the demo as given.

## 0.108.0

- **Qualify the deal.** Ten questions that are the same on every line, asked alongside the technical ones:
  - pain, a date that makes it urgent, and the measured result;
  - who decides and signs, and how the options will be compared;
  - the steps to a choice, and budget, procurement and legal;
  - what would convince them, a champion, and the alternatives (staying as they are among them).

  Each is known, partly known or not yet, with what was heard, a "How to ask it", and the tag most sales methods use (MEDDPICC among them). The answers open three gates: **ready for a demo built for them**, **ready to propose a proof of value**, **ready to put a date in the forecast**. The page says what to do now and what the next gate still needs, with the follow-up question for each.
- The deal goes into the meeting summary, never into the customer readout. On the presales desk, a proof or a decision without the decider known is a risk that can lose the deal, and a deal without a date is one to watch. The example prospects carry deal answers of their own.

## 0.107.0

- **Discovery questions that dig.** The infrastructure lines carry 167 questions, up from 119. New ones are:
  - hardware support dates and a week of performance data with its peaks;
  - switched-off machines that still hold data, licences per core and the busy part of each database;
  - the round-trip time between sites, peak concurrent users and user groups;
  - clean recovery after ransomware and containers left on the old platform.
- **How to ask each question.** Every question says who to ask (executive sponsor, architect, operations, security, application owner, data team or finance). It says whether it is one of the five to seven essential questions not to leave a first meeting without. Under **How to ask it**, it says what a strong or a worrying answer sounds like and the follow-up that goes one level deeper.
- **This meeting.** The workshop narrows to the essential questions, or to the people in the room. The questions come in the order of a conversation: value first, then the stages. **Question guide** copies or downloads the narrowed list with who to ask, what to listen for and what to ask next. **The next meeting** lists the essential questions not asked yet, and who can answer what is open.
- Profiles: discovery questions may carry `role`, `core`, `listen` and `probe`, each checked when the profile loads ([docs/profiles.md](docs/profiles.md)).

## 0.106.0

- **Evidence of a technical win, per deal.** A checklist out of 100, read from what is recorded; it is not a probability. It counts:
  - the line to start with, and what is at stake in the customer's words;
  - conditions with owners and dates, none late;
  - a sponsor for the proof, three or more criteria agreed, and the share met;
  - every concern the customer raised being in the proof;
  - a case for change for finance.

  The desk shows it per opportunity with what would raise it, and the Monday note and the CSV carry it. Desk snapshots carry it too: the team view shows each engineer's median, and snapshots from before it are still read.

## 0.105.0

- **The presales desk at work, in one link:** `?start=presales` opens the desk at once, without waiting for the engine. On a first visit it is filled with the invented prospects; a browser that already holds real work only opens the desk, adding nothing. The installed app gets a "Presales desk" shortcut. The README and the page for presales leaders start from it.

## 0.104.0

- **Your team, for a presales manager.** On the presales desk, each engineer downloads a snapshot of their desk: stages, risks, outcomes, what customers pushed back on, the gaps heard. It carries no notes, no figures and no names of people, and prospect names can be swapped for aliases. The manager reads the team's snapshots together:
  - each engineer's pipeline by stage, with deals won, lost and at risk;
  - the deals that could be lost across the team;
  - what the team's deals teach;
  - a team review to copy or download.

  Snapshots are checked field by field (a forged one is refused whole), read for that visit only, and never stored. "Try it with two invented engineers" shows it at once.
- **For presales leaders:** a page on what the team gets, what a leader sees, why it can be adopted tomorrow, and a five-minute tour ([docs/leaders.md](docs/leaders.md)).

## 0.103.0

- **How each deal ended.** A proof of value records its outcome: won, lost or no decision, the main reason (technical fit, price, went with someone else, timing, no budget, stayed as they are, other), the date and a sentence. A decided deal leaves the live pipeline and shows as won or lost; the Monday note and the pipeline CSV say so.
- **What the deals teach, on the presales desk.** Across every prospect:
  - outcomes and reasons, the share won, and the share of proofs met;
  - what customers push back on, and how those deals ended;
  - the gaps heard most and the tests not met;
  - the median days of each stage, and where deals start.

  Copy it as Markdown for enablement and leadership. It is built from plain facts per deal: no notes, no figures.
- **The invented desk** has two deals already decided, one won and one lost on price, and concerns raised on the others, so the lessons show at once.
- **Fixed:** the "Decision" chip on the desk was just below the contrast ratio the text needs in the light theme.

## 0.102.0

- **A first backup capacity sketch** for object storage. It covers:
  - what a retention scheme holds (one full, daily points, weekly and monthly fulls), each kept full adding only what changed;
  - data reduction, growth, how full the store may get, and the protection overhead;
  - the result in usable and raw TiB, and the bandwidth the nightly window needs.

  Every step is written out, with notes on locking, restore tests and optimistic reduction. It appears in the meeting summary and the handover to delivery.

## 0.101.0

- **The next meeting.** In "Where to start", an agenda built from what the last meeting left open:
  - what slipped;
  - the questions nobody could answer;
  - the customer's concerns and how each will be proven;
  - what is due soon;
  - who it helps to have in the room.

  Copy it, or download an invitation for the chosen day that carries it.
- **The README** describes the presales arithmetic and the handover, and says plainly that the sketches settle the order of magnitude: the vendor's tools and a benchmark on the customer's workload have the last word.

## 0.100.0

- **A first recovery design** for disaster recovery. It works from the protected data (from the inventory, or typed in), the daily change, the busiest hour and the distance between the sites. For three tiers of applications, each with its recovery point and recovery time, it gives:
  - the replication the tier calls for, saying when the distance rules out zero data loss;
  - the bandwidth needed to keep up with the busiest hour;
  - a retention to agree.

  Each step is written out, with notes that hold whatever the product. The design appears in the meeting summary and the handover to delivery.

## 0.99.0

- **A first GPU sketch** for AI on the customer's own infrastructure. It covers:
  - the memory for the weights and for the conversations in flight;
  - the GPUs one copy of the model takes, inside one server;
  - the copies the load needs and, with a measured figure, the speed each user should see;
  - at least two copies for availability, and the servers that makes.

  Every step is written out, with what decided the count and what to check before relying on it. The assumptions are kept with the workshop, and appear in the meeting summary and the handover to delivery. A starting point for a benchmark, not a sizing.

## 0.98.0

- **The invented example comes complete.** "See a filled-in example" now opens a prospect where every presales view has something to show:
  - conditions with owners and dates;
  - three concerns raised by the customer;
  - sizing assumptions agreed;
  - a case for change in its own figures, shown in the readout.
- **The customer readout says who it helps to have at the next meeting,** from the line to start with.

## 0.97.0

- **What could stop a deal, on the presales desk.** Read from what is already recorded, with what to do about each. The risks that can lose a deal on their own come first:
  - conditions agreed and now late;
  - a proof of value with no sponsor;
  - a proof ending within a week with tests not yet tried;
  - concerns the customer raised that are not in the proof;
  - a proof that ended not met.

  Then what to watch: no end date, an open first-day checklist, nothing at stake in the customer's words, no case for change, sizing on the defaults, unanswered questions, a prospect not touched for three weeks. Each opportunity shows how many risks it carries; the Monday note lists the ones that can lose a deal; the pipeline CSV carries them all.

## 0.96.0

- **Handover to delivery.** From a discovery workshop and its proof of value, the note the delivery team reads before the kickoff:
  - what the proof showed, criterion by criterion with evidence;
  - what the customer asked us to prove, and whether it was;
  - what still has to be made true, with who and by when;
  - the numbers it rests on: inventory, sizing sketch, plan in waves, case for change;
  - who to keep involved, and what is still open.

  It ends with the promises to keep after go-live: tests passed that must stay true, conditions we agreed to make true, and concerns not yet proven. **Keep them as commitments** adds them to the customer's commitments, never twice, so what presales promised is followed after the sale. Copy it, or download it as Markdown.

## 0.95.0

- **The case for change.** A new view in the discovery workshop puts staying and moving side by side, month by month over one to seven years, in the customer's own figures:
  - **Staying:** the current platform's yearly cost, the rise at the next renewal and when it comes, and a hardware refresh due if nothing changes.
  - **Moving:** the new platform's yearly cost, the one-off cost of the move, and any hardware bought for it.
  - **Running it:** routine hours before and after, and the cost of an hour.
  - **Downtime:** hours down before and after, and the cost of an hour. A figure the customer gave in the workshop can be used for it in one click.

  It shows the totals, the difference, the payback month, a chart, a table by cost line and the arithmetic in words. **Copy for finance** gives it as Markdown. The case appears in the meeting summary, and in the customer readout when asked. It prices nothing and quotes nothing.

## 0.94.0

- **A plan in waves.** From the VM inventory read in a discovery workshop:
  - a test wave first, from the cluster that teaches the most for the least risk, then cluster by cluster, the least risky first;
  - each wave capped in size and spaced in time, with its date, machines, vCPU, memory and how many machines run operating systems past support;
  - settings agreed with the customer: first date, the most machines per wave, the days between waves, the size of the test wave, and whether powered-off machines move or are retired;
  - the same steps for every wave: before (owners, approval, baseline, data copied ahead, rollback written down), on the day (go or no-go, cutover in the window, test against the baseline, sign-off or rollback), and after (policies checked, lessons into the next wave, old machines removed after an agreed period);
  - one calendar event per wave, plus a place in the meeting summary and in the customer readout ("How the move would run").

  Only totals and cluster names are used.
- **Fixed:** calendar files now escape semicolons in text as the format requires. Before, a customer name with a semicolon could split a calendar entry.

## 0.93.0

- **Prepare the conversation.** A new view in the discovery workshop gives, for each line in scope (the line to start with first), the message in one sentence for the executive, the technical team and finance, who to have in the room, and the objections to expect: each with the question to ask before answering, the answer, and how to prove it. Mark an objection when the customer raises it: it goes to the customer readout ("What you asked us to prove"), to the meeting summary ("Concerns they raised"), and into the proof of value as a success criterion. The meeting summary also tells the first line's story for each audience.
- **Messages and objections for every infrastructure line,** vendor-neutral (`story.json` in each profile; a test keeps vendor and product names out of the infrastructure profiles).
- **Migration as a programme, not a replacement:** what will be visibly better after the move, an owner signing off each application against a baseline, labels applied as machines move so protection and security apply on arrival, the services planned after the migration; a test wave run end to end with its go or no-go, cutover window, sign-off and rehearsed rollback; servers to reuse checked for boot device and network cards.
- **Hybrid cloud:** existing cloud commitments, projects on hold for late servers, software licensed per core, provider funding for the move; the test footprint priced on demand, reserved and against commitments.
- **Private AI:** who owns AI in the business, cost per finished piece of work rather than per token, where models run and how each is paid for, the stage of each initiative, GPUs shared with quotas, air-gapped use, the data each pipeline creates; tests that compare two models on cost and quality per job and change the model without changing the application.
- **Hyperconverged:** performance tested with many machines and disks at once against a baseline; tested platform updates pre-approved and run during the working day.
- A connector whose API answers with something that is not JSON now says whether the response was empty or how long it was.

## 0.92.0

- **A first sizing sketch.** In a discovery workshop with an inventory read, a server count with the assumptions agreed with the customer (growth, vCPU per core, memory overcommit, protection, cold data, data reduction, how full storage may get, spare servers, what one server holds). Every step of the arithmetic is shown, with what decided the count and how full each resource would be with a server lost. Protection follows the rules of distributed storage: two or three copies (at least 3 or 5 servers), or erasure coding on cold data, 4+1 at 1.25x or 4+2 at 1.5x (at least 6 or 8 servers). Storage is kept below 75% of what is left after a failure. Design notes come with it: alike servers, failure domains, data reduction measured before it is counted. In the meeting summary too. A sketch to agree the order of magnitude, not a sizing.
- **The first day of a proof of value.** Each infrastructure line has its own readiness checklist (for hyperconverged infrastructure: the addresses per server for host, controller and out-of-band management, a cluster and a data services address, DNS and NTP, switch ports and VLANs, supported hardware, the failures to test). A proof of value started from a workshop lists it first.
- **A new kind of product, vendor-neutral:** `microsegmentation` (network microsegmentation: see east-west traffic, label machines by application and environment, keep environments apart, watch policies before enforcing them, quarantine a suspect machine with a forensic option, keep policies when a machine moves or fails over, evidence for auditors). With proof-of-value criteria, a readiness checklist, discovery questions, links to the rest of the portfolio, an invented example customer, and a place in the "Resilience and ransomware" workshop.
- **Deeper discovery** on the infrastructure lines: failure domains, capacity headroom and alerts, performance tiers and data reduction (hyperconverged); recovery tiers, retention, and applications recovered together in order (disaster recovery); copying data ahead with a cutover within a week, and databases moved or rebuilt (migration); a small standing cluster in the cloud that grows at failover (hybrid cloud); AI already in use across the business (private AI); cold files moved to cheaper storage (file storage); clusters on physical servers (Kubernetes).
- New proof-of-value tests: a lost server's data rebuilt without an operator, timed; an application and its database recovered together, from the same moment, in order.

## 0.91.0

- **Work as a pre-sales engineer, with a desk of your own.** Choosing "Pre-sales engineer" adds a presales desk to the menu, and the app opens on it next time. It shows every prospect kept in this browser at its stage (discovery, journey agreed, proof of value, decision), what is due in the next two weeks and what is late, a row per opportunity with the line to start with, what is at stake, how the proof is going and the next thing to do, and opens each where it stands. See [docs/presales.md](docs/presales.md).
- **For the account team:** the Monday update in Markdown, and the pipeline as a CSV whose cells cannot run as formulas in a spreadsheet.
- **Invented examples for the desk:** four made-up prospects at four stages, dated around today, added and removed in one click.
- The "Sales engineer" role is now "Pre-sales engineer", with call prep and the call among its first views.

## 0.90.0

- **Their inventory, read in the page.** In a discovery workshop, read a VM inventory export as CSV (the vInfo sheet of a common inventory tool, or a hand-made sheet): machines and how many run, vCPU and memory in use, storage, hosts and clusters, machines powered off, operating systems past general support, and a first wave to test. It brings the migration line into scope, puts what it found under the questions it answers, and heads the journey, the readout ("Where you start from") and the summary. A starting point for a sizing tool, not a sizing. Only totals and cluster names are kept, never machine names; an invented export is included to try it, and the example workshop comes with it.
- **Three new kinds of product**, vendor-neutral: `private-ai` (AI on your own infrastructure: GPU clusters, model endpoints, permission-aware retrieval, agent guardrails, cost per team), `hybrid-cloud` (the same platform in public or sovereign clouds: mobility, recovery to the cloud, data residency, hibernation) and `euc` (virtual desktops and applications: images, profiles, logon time, secure access, bursting). Each with proof-of-value criteria, discovery questions with conditions and first steps, links to the rest of the portfolio, and an invented example customer.
- **Three new starting points** for a workshop: AI on our own infrastructure, hybrid and sovereign cloud, the digital workplace.
- **Platform migration** asks which servers and storage arrays must stay in use, and until when they are supported: reusing hardware already owned can change the cost and the timing of a move.
- The estate map makes room for a whole portfolio of ten lines.

## 0.89.0

- **The plan by date.** Dated conditions in the journey are listed by month, and **Add to a calendar** downloads them as an .ics file, one all-day event each, for Outlook, Google Calendar or Apple Calendar. Made in the page; nothing is sent.
- **From the estate to discovery.** Each line in "Where to grow" can start a discovery workshop with the same customer on that line: land and expand in one click.
- **Prepared by.** A workshop can carry the name of who prepared it, and the customer readout is signed with it.

## 0.88.0

- **The journey becomes a mutual plan.** Each condition can be given who makes it true (us, the customer, or together) and by when. Owners and dates show in the customer readout ("Who, by when") and in the meeting summary, and survive a changed answer or figure. When presenting, they show as text.
- The README, the app and the extension now describe the project from discovery to renewal, for infrastructure as well as security.

## 0.87.0

- **A filled-in example workshop**, from the start page: an invented logistics company leaving its virtualisation platform, worried about recovery, with answers, notes and figures. It opens on the journey, so the method can be shown in thirty seconds.
- **Start from a conversation:** resilience and ransomware, leaving a virtualisation platform, modernising applications, securing the cloud. Each sets the usual lines in scope; answers already given are kept.
- **Present:** the journey and the estate can be shown alone and larger, full screen where the browser allows, for a shared screen. Esc brings the app back.
- **Delete this workshop**, after a confirmation.
- A figure at stake is now shown with the question it answers.
- The five-minute demo guide has a presales version.

## 0.86.0

- **Quantify the impact.** A business-value answer in the discovery workshop can carry a figure, counted per hour, day, week, month, year or incident ("2,000,000 per day"). The figures head the journey, the meeting summary and the customer readout, each with what it measures; a figure is kept when the answer or the note changes, and validated on import.
- **Fixed:** a question not yet answered showed the word "null" under its buttons, and a line not yet discussed showed it in its heading. Every redraw now drops empty parts, and the browser tests look for stray "null", "undefined" and "NaN".
- **Fixed:** a note and a figure typed in quick succession could overwrite each other. Workshop edits are now applied one after another, each on the result of the last.

## 0.85.0

- **New kind of product: moving off a virtualisation platform** (`platform-migration`). Sites whose virtual machines move to a new platform in waves: discovery with owners, dependency mapping, wave planning, test migration, automated cutover, a tested rollback for every wave, backup and monitoring working on the new platform before the first production wave, and the old platform switched off. Vendor-neutral.
- Ready for a sale like the others: five proof-of-value criteria (a representative group migrated within its window, a rollback against the clock, restores on the new platform, alerts reaching the same people, a dependency map confirmed by its owner), eight discovery questions each with the condition it tests and a first step, and an invented example customer, Vantage Insurance, from the start page.
- In the infrastructure family for the discovery workshop and the estate: a migration leads to the platform and to recovery ("recovery must work on the new platform before the old one is switched off"), and a platform in place leads to migrating what is still on the old one.

## 0.84.0

- **Customer readout.** A page for the customer, from the discovery workshop: "Yes, this is possible", what would need to be true, where they are today and the first step for each, how each step would be proven, what we heard and what to settle at the next meeting. In the customer's language (no scores, no stage codes), with what is at stake in their own words. Download it to send or print, or show it on screen; it has no scripts, loads nothing, and everything typed is escaped.
- **Built for the meeting itself.** After an answer the next question is selected, and the keys 1 to 4 answer it (Solved, Partly, A real gap, Nobody knows) without switching views.
- **Where to start**, not where it hurts: the workshop's second view now speaks of what is still missing on each line rather than of pain, in line with the journey.
- **Estate:** each line that puts another at risk now comes with the first step on the weak line and what it is worth, in the view and in the account plan.

## 0.83.0

- **The journey: from "can we?" to "what would need to be true?".** A new view in the discovery workshop opens on "Yes, this is possible." and turns the answers into a path: agree what success looks like, prove it on the first line, then the lines it leads to. Every gap or unknown becomes a condition to make true, with where the customer is today (in their words), the first step towards it and how the step is validated; what is already true is shown too, and what is at stake heads the page.
- Every discovery question in every profile now carries the condition it tests (`need`) and a first step (`how`). A test keeps it so.
- The meeting summary carries the journey as a checklist, ready for the follow-up email.

## 0.82.0

- **Discovery workshop, from the start page, with no data.** Choose the product lines in scope and record, question by question, what the prospect says: solved, partly, a real gap, nobody knows, with their words in a note. The questions are each profile's discovery questions, two on business value and six tied to a stage. See [docs/workshop.md](docs/workshop.md).
- **Where it hurts.** The line to start with and the answers that point there, a map of the lines in scope filled by pain (dashed when not discussed yet), the path after the first line, and what nobody could answer, as the list for the next meeting.
- **From discovery to proof of value in one click.** The proof of value opens with the first line's own success criteria and how to test each, and a problem statement made from the gaps heard. The meeting summary is ready to send.
- Workshops are sealed customer facts: kept in the browser under a random slot, erased with the customer, carried in the workspace file and checked on import.
- Discovery questions for identity, security monitoring and endpoint, so every security line can be run in a workshop too.

## 0.81.0

- **One customer, every product line.** Drop a folder whose sub-folders are the same customer on different profiles (platform, databases, files, recovery…) and it opens as an estate, not a book. Each line is scored on its own profile and in its own units; the estate shows what really works across them, weighted by ARR, next to the usual number. See [docs/estate.md](docs/estate.md).
- **The estate map.** The first line of the family in the middle, the others around it. Red links where a solid line leans on a weak one ("the platform is at 71.9%, recovery at 42.8%: losing a site would still mean rebuilding by hand"); dashed links to the lines the customer could run next. Select a ring to open that line's report, or a dashed circle to see why it could come next.
- **Where to grow.** The missing lines of the family, in the order they follow from what already runs, each with the reason, the question that opens the conversation and a proof to offer.
- **Account plan.** The whole estate as a document: lines in place, risks between them, where to grow, the questions for the next meeting. Also `beyond90 estate <folder>` on the command line.
- New example: Halden Group (mock), one customer on four infrastructure lines, from the start page.
- Heat cells keep their contrast in the dark theme; the phone bar shows only the views the open mode has.

## 0.80.0

- **Four new kinds of product, for infrastructure portfolios.** `dbaas` (database platform as a service: provisioning, patching, point-in-time recovery, masked clones), `file-storage` (scale-out file storage: snapshots, ransomware detection, audit, permission review, tiering), `kubernetes-platform` (managed clusters: upgrades, workload backup, admission policy, cost per team) and `dr-backup` (recovery objectives, tested failover, immutable and isolated copies). With `hci` and `object-storage`, a presales or account team covering a whole infrastructure portfolio can run every line on the same method. All vendor-neutral.
- **Each one ships ready for a sale.** Five proof-of-value criteria with how to test each, eight discovery questions tied to a stage, a playbook for the first stage and an invented example customer you can open from the start page (Aurora Clinics, Northgate Partners, Pixel Forge, Harborline Retail).
- `beyond90 validate` counts in the profile's own words ("14 database environments", "11 sites").
- A profile can give a shorter word for the side menu (`"menu": "Databases"`) when its units are long.

## 0.79.0

- **See an action's effect before you take it.** On Today, pointing at an action (or moving to it with the keyboard) shows where Yield would land next to the number ("72.6% → 76.6%"), and the stage it works on grows in place with its new value. The stage rises so the four stages still multiply to the new Yield. The other actions dim while you look.
- **Every view ends with the next step.** One suggestion at the foot of the view, worked out from the data, with a button that goes there already filtered: from Overview, "Most accounts stop first at L3 (42 of 121)"; from Onboarding, the accounts not connected; from Prep a call, the promises past their date when there are some; from Findings, the action that gives the waiting findings an owner.
- **The search box answers.** `/` or Ctrl+K now lists what the data says next to the views: "2 promises are overdue", "42 accounts stop at L3 switched on", "11 critical findings are open", the first actions. Short words find them ("late", "L3", "risk", "unowned"), and each opens where it is, filtered.

## 0.78.0

- **No more "finding(s)".** A scan of every view of two example customers found about twenty kinds of counted noun written with "(s)" ("13 finding(s)", "1 accepted risk(s) reach", "4 account(s) connected"), and a few "1 findings" and "1 days". Every one now agrees with its number, verbs included ("1 critical finding has no owner", "3 connector secrets expire"), in the engine (`beyond90.words`) and in the page (`words.js`). A test fails if a counted "(s)" comes back.

## 0.77.0

- **A front page that explains itself.** The README opens with one sentence, a picture of Today, the three numbers on the example customer (the usual 92%, Yield 72.6%, 29 of 121 accounts end to end), the three ways to try it, and what it does in eight lines, with four pictures. The longer text follows under "In depth".
- **Pictures that cannot go stale.** `scripts/screenshots.py` takes every picture in the README and the docs from the built site, with the invented example data, plus a social card for the repository. All pictures now show the current design.
- "1 connector counted as connected is failing", not "1 connector(s)".

## 0.76.0

- **Every profile reads in its own words.** A walk through the hyperconverged example found cloud wording left over; it is gone. The Accounts view is named after the profile's units in the menu and the title ("Clusters", "Tenants"); onboarding says "Where clusters stop" and names the "cluster owner"; the call prep counts clusters, not accounts. The connector error explainer and the kickoff checklist, which know public clouds and Kubernetes only, show for the cloud security profile alone.
- **Real plurals in actions.** "Connect 1 cluster owned by plant-it", "Enable Immutable snapshots against ransomware on 2 clusters", "1 cluster stuck in onboarding": no more "cluster(s)".

## 0.75.0

- **More like a phone app.** Installed from the browser, Beyond 90 now offers two shortcuts on a long press of its icon ("See it on an example", which opens the example already analysed, and "Saved customers"), reuses the open window instead of opening a second one, and accepts files shared from other apps: on Android, Share, then Beyond 90, on an export from mail or Files opens the app with the files loaded. The share goes to the app's own service worker, never to a server: at most 50 files of at most 20 MB, only `.csv`, `.toml` and `.xlsx`, folder paths stripped, in a local inbox emptied as soon as the page opens. Tests send a share with a `.exe` and a `../` path and check both are handled.

## 0.74.0

- **End to end across the book.** The portfolio report (`beyond90 portfolio`, Markdown and JSON) and the browser's book table now show, next to each customer's Yield, how many of its accounts pass every stage. On the examples: Contoso Bank 136 of 220, Northwind 29 of 121, Fabrikam Labs 0 of 27. Two customers with a similar Yield can differ a lot here, and the difference says whether the work is a rule applied everywhere or a few accounts to finish.

## 0.73.0

- **Actions marked done are kept, and newer data checks them.** "Mark done" on Today used to last only while the tab was open. A mark is now a customer fact like a promise: kept in this browser, sealed with the passphrase when one is set (under a random slot, because action ids name the customer's teams), included in the sealed workspace export and import, and erased with the customer. Each mark remembers the date of the data it was made on. When newer data still contains the action, Today puts "1 action you marked done is still in the newer data" at the top of Keep an eye on: the work did not land, or not everywhere. When the action is gone from newer data, Today says the mark is confirmed.
- **A missing page module is caught by the tests, not by the browser.** The page's file list is now one constant, and a test reads every `import` of every page script and fails when one names a file the build does not ship.

## 0.72.0

- **Set or move a proof of value's window at any time.** The mutual plan card now carries the start and end dates, so a plan made without a window can get one later, and a window that slips can be moved; every step of the mutual plan is re-dated at once. An end before the start, or a date that is not a date, is refused with a plain message.

## 0.71.0

- **A mutual plan to signature.** A proof of value with a window now shows both sides' steps from criteria sign-off to signature, each dated from the window: sign-off a week before the start, access and people ready, kick-off, a mid-point check, the last test session with evidence for every criterion, the readout, the sponsor's decision and the commercial, legal and security review. Each step reads done (when the plan records it: sign-off date, readiness ticked, sessions held, every criterion tried), late or open. The dates after the readout are proposals to agree with the sponsor, and the copied plan says so. One button copies it as a Markdown table.

## 0.70.0

- **Discovery questions, weakest stage first.** A profile can ship questions to ask the customer, each tied to business value or to a stage and with the reason to ask it ("Are your backup copies under object lock, and for how long? Backups an administrator can delete do not survive ransomware."). Prep a call lists them in the order that matters for this customer: business value first, then the stage where the customer loses most, marked "weakest", then the others. One button copies them as a plain list. `beyond90 discovery <customer>` prints the same list (`--format json` too). Shipped for cloud security, hyperconverged, object storage, SaaS and AI; a profile adds its own in `discovery.json`.

## 0.69.0

- **Two infrastructure profiles: hyperconverged and object storage.** `--profile hci` measures clusters (on premises, remote office, hybrid, edge) on health monitoring, snapshot schedules, replication with a tested recovery plan, immutable snapshots, microsegmentation, encryption at rest, automated upgrades, capacity runway and self-service. `--profile object-storage` measures S3-compatible storage tenants on metering, versioning, object lock, replication, data residency, customer-managed keys, scoped keys, access logging, lifecycle tiering and restore testing. Each has an invented example customer: Granite Manufacturing (Yield 57.5% against a claimed 80%) and Meridian Health (58.4% against 87.5%, with object lock missing on five tenants among the first actions).
- **Suggested proof of value criteria.** A profile can ship tests a sponsor can sign off for that kind of product, each with how to check it ("an object under lock cannot be deleted, even with administrator credentials, until its retention ends"; "a host fails and its virtual machines restart elsewhere with no manual step"). The Proof of value view lists the ones not yet in the plan, with an Add button each. Shipped for cloud security, hyperconverged and object storage.
- **Every kind of product one click away.** The start page keeps three large example cards and adds a compact row for the six other kinds: SaaS, AI, identity, SIEM, hyperconverged and object storage.

## 0.68.0

- **How many accounts each action finishes.** Effect in points gives partial credit and can hide what an action completes. For the first 25 actions the engine now applies the action's own operations to a copy of the data, as the what-if does, and counts the accounts that pass every stage afterwards and did not before. On the example customer, connecting three accounts adds 2 points and finishes none (a newly connected account still has every other stage to do), while switching remediation automation on adds 2.1 points and finishes 9. Today shows it under each action and gains a third ranking, "Most finished"; the Actions table has a column for it. `beyond90.unlocks` holds the calculation.

## 0.67.0

- **From the end-to-end bar to the accounts behind it.** Each item under the bar on Today is a button: "42 stop at switched on" opens Accounts filtered to exactly those 42. Accounts has a new "Stops at" column (the first stage where each account stops, or "passes all"), a matching filter, and the column in the CSV export. The engine's per-account check is now one function, `scoring.account_stops`, used by both the score and the table.

## 0.66.0

- **End to end: the same chain on one unit.** Yield multiplies four ratios measured on different units (accounts, asset type pairs, capability pairs, findings), so it is a product of completion rates, not the share of accounts that make it all the way. The score now also counts that share: an account passes when it is connected, every expected asset type is seen, every relevant capability is on, and none of its findings past triage lacks an owner or a decision. Each other account is counted once, at the first stage where it stops. On the example customer: Yield 72.6%, end to end 29 of 121 (24%), the others stopping first at L1 12, L2 29, L3 42, L4 9. It is in `beyond90 score`, in the JSON score as `end_to_end`, and as a bar under "Where it leaks" on Today. [docs/why-multiply.md](docs/why-multiply.md) explains both numbers and their limits.

## 0.65.0

- **A phone top bar with room to breathe.** With a customer open, the top bar on a phone holds only the customer's whole name with the date of the data under it, and a search button. The names selector and the light/dark switch moved into the menu sheet. Whenever names are hidden or replaced by aliases, a small flag in the top bar says so, so what leaves the page is always visible. The search button keeps its spoken name.

## 0.64.0

- **Run it on your own computer, without the public site.** Every release now carries `beyond90-local-<version>.zip`: the built app plus a `start.py` that needs only Python 3.9 or newer. Unzip, run `python3 start.py`, and the browser opens `http://localhost:8090`, served by your own computer, read-only, reachable from that computer alone. No npm, no Docker, no account; customer files are read inside the browser as before. The zip is reproducible, listed in the release checksums and covered by its signed provenance; tests build it twice, start it, fetch the page and check that writes are refused. The public site offers the same file under `download/`.
- The self-hosting guide no longer says `pip install beyond90`: the package is not on PyPI, so it says to install from a clone.

## 0.63.0

- **Mark an action done from Today.** Each of the first actions has a "Mark done" button. The next one moves up, the count in the menu drops, and a line says what the done ones add: "up to +6.5 pts, about 79.1%", named as an upper estimate because effects overlap. Undo is one click. The marks live only in this tab's memory: action ids carry the customer's team names, and nothing about a customer is written outside the protected store, so the next data load is what records the work.
- A test now checks Today, too, for anything wider than a phone screen.

## 0.62.0

- **The start page shows the idea before the first click.** Next to the headline, a dark card shows the example customer: the usual number struck through, what really works beside it, and the four stages as bars with the weakest marked. The figures are computed by the engine from the example data when the site is built, and a test checks that they match, so the picture cannot drift from the product.
- **No empty run bar.** The "Analyse" bar at the bottom of the start page now appears only once there are files to analyse, instead of covering the example cards.

## 0.61.0

- **Keyboard shortcuts.** `g` then a letter jumps (`t` Today, `o` Overview, `a` Actions, `f` Findings, `c` Accounts, `b` Risk burn-down, `p` Prep a call, `m` Promises, `v` Proof of value, `w` This week); `[` and `]` step through the menu; `/` searches; `?` shows the list, also reachable from the bottom of the menu. Keys typed into a field are left alone.
- **Every view gets to the point.** The five number tiles now show only on Overview, Changes and Value receipt; elsewhere the menu's pulse carries them, and the content starts about 200 pixels higher. The view header is one block with "Pin to menu" on the right.

## 0.60.0

- **A new menu.** The side menu opens with the customer's pulse: Yield and the four stages as bars, the weakest one marked; a click goes to Today. Views with something waiting carry a live count (actions open, findings that need a person, critical findings, accounts not connected, connectors stuck, promises overdue), red when someone is needed now. Groups fold and the menu remembers which. Any view can be pinned to the top with "Pin to menu" (up to six).
- **A phone that feels like an app.** With a customer open, the bottom bar is Today, Actions, Call and Menu; the full menu opens as a sheet and closes when you choose. The two rows that used to sit on top of every phone screen are gone, and the work header shrinks to one row.
- **Today as a dashboard.** On a wide screen, two columns: the number and its trend over saved snapshots, next to "Where it leaks" (the four stages as bars, the multiplication written out, what is lost in 90 days if nothing is done); then the actions, with a switch between the biggest effect and the quickest wins (kept on this browser), next to up to three things to keep an eye on, each with its button.

## 0.59.0

- **A worked case.** [docs/case-northwind.md](docs/case-northwind.md) follows the example customer from "we are at 92%" to a plan: what the four stages show, what to say, the three actions, the questions to expect. The figures are the ones in the example data.

## 0.58.0

- **Spreadsheet exports in other locales.** Files separated by `;` or a tab (what many spreadsheet programs write where the comma is the decimal mark) are now read, and the loader says which separator it used. In a `;` file a decimal comma such as `1234,5` is read as a number. A row with more values than columns is refused instead of silently cut. A date written day-first (`31/10/2026`) still is not guessed, because it is ambiguous, but the message now says to save dates as `YYYY-MM-DD`. The account importer reads such files too.

## 0.57.0

- **Today flags promises you owe.** When a promise to the customer is past its date, Today puts it at the top of "Keep an eye on", with a button to the promises ledger. It is the thing an account manager forgets first and the customer remembers longest.

## 0.56.0

- **Two more profiles: identity and SIEM.** `--profile identity` scores directories, identity providers, privileged access and cloud identity on sign-in strength, single sign-on, vaulting, just-in-time access, access reviews, lifecycle, service accounts and identity threat detection. `--profile siem` scores environments on log source onboarding, parsing, detection content, enrichment, retention, case handling, playbooks and source health. Both had been listed "on paper" and are now shipped, with an invented example customer each (Harbor Identity, Lantern SIEM).

## 0.55.0

- **A warning before private material leaves.** The QBR draft ends with a section for the account manager only (renewal readiness, the trust reading, ratings of people). When a text with any of that is copied or downloaded, the page now says so: in the status line at full names, and at the top of the preview when pseudonyms are on. It warns and does not block, because you may be sending it to yourself.

## 0.54.0

- **Three tests that stop the page from sending data out.** The build now fails if any script of the page uses a channel that could carry data away (XMLHttpRequest, WebSocket, beacons, event streams, peer connections), if a `fetch` points anywhere but a file of the site itself (apart from the two offline probes, which are meant to fail), or if a `fetch` is given a body or a method. The device's share sheet is allowed once, for the encrypted workspace only. The CSP already forbade these; now the code is checked too.

## 0.53.0

- **Demo customers for SaaS and AI.** Two invented customers, Acme SaaS and Orbit AI, with a demo button each on the start page, so every shipped profile can be tried without writing a file. A test checks that the committed files are exactly what the generator writes.

## 0.52.0

- **A README you can read in a minute.** A short "In one minute" section now opens the page: what it is for, how to try it, how to run it, and what it is not. The longer text follows unchanged.

## 0.51.0

- **For account managers.** Two short documents: [the first 90 days with a new customer](docs/first-90-days.md), a plan to put in front of a customer, and [showing Beyond 90 in five minutes](docs/demo-5-minutes.md), a script for explaining the project out loud. A `CITATION.cff` names the author so the repository can be cited.

## 0.50.0

- **A first minute on Today.** Until you hide it, Today shows three steps: read the sentence at the top, open the first action, prepare the next call, each with a button. "Got it, hide this" keeps it hidden on this browser only (one flag in local storage, nothing sent anywhere).

## 0.49.0

- **Three more checks on the input data.** The "how far to trust this number" panel now also flags findings dated after the data (every age is wrong for them), owner values that are placeholders such as "tbd" or "n/a" (they count as owned and flatter L4), and accounts marked not connected that still show active capabilities or inventoried assets (one of the files is stale). Each says what to check. They change the confidence, never the score.

## 0.48.0

- **Accounts and Findings open with the answer.** Each view now starts with one sentence ("3 of 12 accounts are not connected", "2 of 10 findings past triage need a person") and the three to look at first, with the reason for each. The tables, filters and CSV export stay below, unchanged.

## 0.47.0

- **Two new profiles: SaaS and AI.** `--profile saas` scores tenants of business applications (mail and office suites, CRM, collaboration, code hosting) on strong sign-in, privileged roles, third-party app governance, sharing controls, data loss prevention, drift, session anomalies, token hygiene and automated response. `--profile ai` scores AI environments (hosted and self-run models, agents, coding assistants) on inventory, guardrails, prompt logging, data leak prevention, tool scoping, key management, model supply chain and adversarial testing. Both are vendor-neutral and checked by the same consistency test as the others.

## 0.46.0

- **How fixes get made.** An optional `closed_by` column in `findings.csv` (`manual`, `assisted` or `automated`) lets the risk view show, for the last 180 days, how many fixes needed no one, how many needed a tool's help and how many were by hand, with the average days each took (shown from three fixes up). Without the column it says what to add. The scorecard carries the automated share when it is recorded. Ignored on a finding that is still open.
- The example customers show all three cases: mostly automated, mostly by hand, not recorded.

## 0.45.0

- **A forgiving search.** "Search or jump to…" now finds a view from part of a word, from a slip of the keys ("acitons" finds Actions), or from its letters in order ("rbd" finds Risk burn-down), and ranks whole words first. Written in the page itself: no library was added.

## 0.44.0

- **Proof of value, rebuilt.** With a plan open, the page leads with one sentence on a dark card (criteria met so far, whether it is worth starting, and days to first value), then the criteria. The form for a new plan folds away under "Start another proof of value" and is open when there is none.

## 0.43.1

- **Risk burn-down, rebuilt.** It opens on one sentence on a dark card (whether the customer is at zero criticals, and how many of the open findings need a decision now), then the four counts, then the oldest critical and high findings to start with. The tables, the target-age editor and the six-month flow follow.

## 0.43.0

- **Actions, rebuilt.** The page opens on the three to start with, each a large card with the points it gains, the hours it takes, who owns it and when it is due, and a "How to do it" fold-out with the steps, when it is done and what to ask the customer. The full list and its filters follow unchanged.
- Updates wait for the person to accept them again (the one-release switch in 0.41.2 and 0.42.0 is off).

## 0.42.0

A visibly new look.

- **New typeface for titles and figures** (Bricolage Grotesque, served with the page like the body face; no request leaves the page), a **dark navigation rail**, a **teal accent** in place of blue, rounder and larger cards and figure tiles.
- **Today** puts the score on a dark card in large teal figures: the one place the page is loud.
- Light and dark modes both follow it, and the accessibility test still passes in each.

## 0.41.2

- **This release switches installed copies by itself.** The previous offer could not be seen on some phones, so this build asks installed copies to take it without waiting; the page reloads once. Saved work is kept. From the next release a new build waits for the person again.

## 0.41.1

- **The update offer can be seen.** "New version ready" sat in the crowded top bar and was easy to miss on a phone. It is now a bar fixed near the bottom of the screen with a large button.

## 0.41.0

- **A calmer look on every screen.** Softer surfaces and shadows instead of hard borders, rounder corners, more space around cards and the figure tiles, a larger page title, quieter side rail. Today hides the figure strip and repeated title so only the answer is left. Dark mode follows the same tokens. Contrast is still checked by the accessibility test in both colour schemes.
- Pages: the deploy no longer fails when the package mirrors are unreachable (this had stopped 0.35 to 0.40 reaching the live page), and one e2e check waits for the saved snapshots before counting them.

## 0.40.0

A first screen that answers one question.

- **Today.** The page now opens on one number, one sentence (how far from the target, and which stage holds the score down most), the three things to do first, and the one thing to watch. Three large buttons lead to the call preparation, the one-page summary and the full overview, which is unchanged. It promises no date and says nothing the numbers do not support.
- **Security review.** Written up in the threat model, with what it does not cover. No code change was needed. Tightening the page's policy against style attributes was tried and withdrawn, because the generated reports use them.
- Tested on made-up data only.

## 0.39.0

- **Out of the noise.** The burn-down shows how many findings are open and how many need a decision now: every open critical or high, and any open medium older than its target age. The rule is printed beside the number, and the page says it is a rule on severity and age, not a judgement of what is exploitable. The scorecard carries the same two counts.
- Tested on made-up data only.

## 0.38.0

Start only the proofs worth running, and see how fast they pay off.

- **Is it worth starting?** A proof of value now asks five questions before the first session: the problem in the customer's words, criteria signed off with a way to tell, a named sponsor and champion, a window that fits the number of criteria, and what is out of scope. It says what to fix for each gap. The answers are yours, not checks against the customer.
- **Time to first value.** Record the day the customer first saw something useful; the result states the days from the start. If it was not recorded, the result says so.
- **Fix: two edits on the same day.** A second change to a proof of value, ask or promise made on the same day could be dropped by the rule meant for merging two files. A change made here now always wins over what is kept. Older plans open as before.
- The Sponsor and Champion fields no longer repeat their label as placeholder text.
- Tested on made-up data only.

## 0.37.0

An assistant that never sees the names, and ready-made questions to ask it.

- **Aliases for the MCP server.** `beyond90 mcp ROOT --pseudonyms` replaces every known customer, person, team and account name in what a tool returns with an alias (Customer A, Person 1, Team 1, Account 1), and turns an alias the assistant sends back into the real name. `--aliases FILE` keeps the table in a file only you can read, so aliases stay the same between sessions. Names it was not told about, such as one typed inside a free-text field, pass through, and an alias is not anonymity: the numbers can still point at one customer.
- **Prompts.** The server now offers three ready-made requests, `qbr_prep`, `weekly_book_review` and `escalation_triage`. Each names the tools to call, says to use only returned numbers and to say what is not known, and treats results as data.
- Tested on made-up data only.

## 0.36.0

Honest targets, fixes that hold, and a scorecard you can show.

- **One set of target ages.** The burn-down used its own default while the score used the customer's `settings.sla_days`. Both now read the customer's file, and the burn-down has a card to set the ages (presets or your own) that writes them there. A changed target is not saved as a new snapshot until you save. In the book, each customer now counts against its own targets.
- **From raised to confirmed.** For critical and high findings of the last 180 days: raised, with an owner, with a decision, closed, and, when the file has the new optional `verified_at` and `reopened` columns, confirmed fixed by a later scan and how many came back. Without those columns the page says it cannot tell. The importer recognises common names for both.
- **Posture scorecard.** One page a customer can show their own buyers or auditors: Yield, stages, risk, how fixes held, and the input fingerprint. It names no finding, account or person, goes through the sharing gate, and says what it does not prove. You can paste a fingerprint to check it against the data loaded now.
- Tested on made-up data only.

## 0.35.0

The burn-down for the whole book.

- **Book burn-down.** In book mode, a table of every customer: critical and high open, findings older than target, the oldest urgent finding, findings with no owner, and who is at zero criticals. Most critical first. Click a customer to open their own burn-down.
- **A fix.** With the Core views chosen, the book's own navigation no longer fell under "More views"; the book always shows all of its views.
- Target ages are still the default (7, 30, 90, 180 days) until a customer's own are set, and the view says to compare customers with care.

## 0.34.3

A calmer first screen.

- **Core views by default.** Until you pick a role, the sidebar shows about ten views (overview, connections, accounts, findings, burn-down, actions, plan, prep, proof of value, report) and keeps the other twenty under "More views". "All" brings back everything.
- **Plainer wording on the gauge.** "The old metric says 92.0% (19.4 points higher than what is really working)", and only the 90 target is labelled on the dial.
- **Phone.** Views other than the overview no longer start with the numbers strip, so the content is the first thing you see.

## 0.34.2

Simpler to pick, lighter on a phone.

- **Role chips.** "I work as" is now a compact row of chips in the sidebar, and the Start page asks it right under the main button, so your views come first from the first result.
- **A tighter phone.** The numbers strip uses three columns, so the first view is visible without scrolling.
- **A cleaner Start page.** The soft background glow fades out instead of ending in a visible edge.

## 0.34.1

- Proofs of value and asks now travel in an exported workspace file and are read back on import (validated, merged, never overwriting a newer copy).

## 0.34.0

Views for the people who run adoption, design the rollout and prove the value.

- **Risk burn-down.** Critical and high findings open, their age against a target, how long fixes take, the last six months opened and closed, and whether the customer is at zero criticals. Target ages are a default and the view says so.
- **Proof of value.** Plan an evaluation with success criteria and a readiness checklist, record what was seen, and copy a result that says what was shown and what it does not show.
- **Asks.** A ledger of what customers asked the vendor for, with what is at stake as a figure you type. The digest groups the same ask across customers and lists escalations oldest first.
- **A role lens.** Choose technical account manager, solutions architect or sales engineer and that role's views come first; the rest sit under "More views". Nothing is removed.
- **Importer.** More column names are recognised (cloud platform, widely internet exposed, created date, resolved date).
- **Known limits.** Tested on made-up data only.

## 0.33.0

A faster first look.

- **One click to a result.** The Start page has a main button that loads the example customer and analyses it, so a newcomer sees a real result without choosing a card and pressing Analyse.
- **A quieter header.** The sharing control is shorter ("Names: shown / people hidden / pseudonyms") and fits a phone's header; the empty "No customer open" label is hidden on small screens.
- **Overview without repeats.** The gauge card no longer repeats reach, open actions and confidence, which the strip above it already shows.

## 0.32.0

Share without the names, and keep only what you should.

- **Sharing levels.** A control at the top chooses what leaves the page when you copy or download: full names, people hidden, or everything replaced by stable aliases (Customer A, Person 1, Team 1, Account 1). You see a preview first: how many names were replaced and what the page can still see. The aliases stay on this device, so you can paste an answer that uses them and put the real names back. A pseudonym is not anonymity, and a name typed in a free note is not something the page can find.
- **Retention and erasure.** Set a keep-until date per customer and the page tells you when it has passed. Erase one customer completely (snapshots, outcomes, promises, aliases, the date, the log) and get an erasure record that says what was removed, that a second look found nothing left, and which earlier exports are beyond its reach. The record is something the page wrote about itself, not proof.
- **A leak closed.** Sealed outcomes and promises were stored under keys that contained the customer's name. They now use random slots; older ones move the first time you unlock.
- **Known limits.** The MCP server has no pseudonym mode (it is read only and has no place to keep aliases). Aliases, retention dates and the export log stay on the device and are not in an exported workspace. Presentations cannot have names replaced, so they are refused at the pseudonym levels.

## 0.31.0

What you owe each other, and a clean handover.

- **Promises.** A ledger across all your customers of what you and they have promised: what is late, what is due this week, what you owe. A finished call can add what was agreed and what you owe in one click (nothing is added twice). Kept in this browser, sealed with your passphrase if you set one, exported with the workspace, and available as a CSV.
- **Handoff note.** One note for whoever picks a customer up: where adoption stands and the three best next actions, what has been promised and what is late, renewal signals and people, how Yield has moved, risks, and earlier renewals. It says what it is built from, leaves out your private call notes, and is text to read and edit before you send it.

## 0.30.0

What matters most to the customer, when they say it.

- **Criticality.** An optional `criticality` column on accounts (critical, high, medium, low) lets the coverage weighted by what is at stake count an account the customer depends on more heavily, and a finding in it too. It multiplies the weight by spend, so a small account the customer cannot do without stops hiding behind a large one it barely uses. Yield is not touched; nothing infers criticality, the customer has to say it, and the page says which weights it used. The importer keeps the column when it rewrites a file.

## 0.29.0

Ask "what if" and "what would it take", and let an assistant ask too.

- **Try a combination.** Tick what you would do (connect the accounts, switch on the modules that can run, give an owner, record a decision, put an expiry) and see Yield today, right after and once it settles. Connecting first lowers Yield, because the accounts enter the denominators before their inventory arrives; the page shows that dip instead of promising a straight line. Each combination is tried on a copy. `beyond90 whatif --do ... | --scenarios file.json`.
- **What it takes to reach a target.** Pick 90% (or any target) and see the sequence of changes that gets there, biggest gain first. It says it does not estimate effort, and says so when the target cannot be reached with what it models. `beyond90 whatif --reach 0.9`.
- **A local MCP server.** `beyond90 mcp ROOT` lets an AI assistant on your machine ask about the customers under one directory: list them by Yield, score one, rank its actions, compare scenarios, find the path to a target. Read only, no network, confined to that directory, with limits on message size. It does not make the assistant safe to show customer data to; the documentation says so.

## 0.28.0

The health reading learns from what really happened, and the call has its own screen.

- **What renewals taught.** Record what happened at each renewal (renewed, expanded, reduced, churned) next to the health reading taken before it. Once there are at least three customers that stayed and three that left, the page compares each part of the reading between the two groups, says how often the score ordered a pair right, and suggests new weights that blend what the data hints at with the current ones, never the data alone. Every figure comes with its count, and below the minimum it says it cannot conclude. Applying the suggestion is a choice you make and can undo.
- **Kept like the rest of your work.** Outcomes are stored on the device, sealed with your passphrase when you use one, and travel in exported and sent workspaces. Values from outside are checked field by field, and a file with more than 2,000 outcomes is cut and reported.
- **On the call.** One screen for the call itself: the prepared agenda to tick off, private notes per item, what is agreed and what we owe as it happens. Then the recap (only what was covered and agreed, never the notes), the agreed actions as a CSV, and the log line for interactions.csv are ready. A call in progress survives a visit to another view.

## 0.27.0

Closer to the work a TAM does every week.

- **Actions as a CSV.** Every open action, one per row, with the columns a ticket tracker recognises on import (summary, description, assignee, due date, priority, labels). Every cell is written so that a spreadsheet cannot read it as a formula. `beyond90 actions --format csv`, and a view in the page.
- **A one-page summary for the CISO.** Coverage in the four parts a customer recognises, what is exposed, what happens if nothing changes, the next three actions and the decisions needed, on a single printable A4 page. No stage names, no maturity labels. `beyond90 onepager`, and a view in the page.
- **Map an export.** Drop a CSV whose columns are named your way: the page guesses which column is which, you confirm, and it writes `accounts.csv` or `findings.csv` with values normalised (severities, providers, yes/no, dates). Rows it cannot read are skipped and counted, an ambiguous date order is reported, and an account list with no connection column says so instead of assuming.
- **Customer health.** Adoption, outcomes, relationship and trajectory in one 0 to 100 indicator, with the weights and the reason for every part shown. A part that cannot be measured is left out and said so, and the band follows the weakest part. Offered as a hypothesis to discuss: it has not been validated against real renewals.

## 0.26.0

Anyone, on any device.

- **Installs as an app** on phones, tablets and computers: a web app manifest and icons drawn from source; Help offers the browser's install prompt and explains iPhone, Android and Firefox. Chromium's installability check passes in e2e.
- **Made for the phone too.** The places move to a bar at the bottom, the customer's views scroll in a strip under the header, tables read as cards, the map scrolls and pinches with a finger and a tap still selects. e2e checks a phone: no view wider than the screen.
- **Excel in.** Drop a workbook instead of CSV files: by file name, or one sheet per file, with a two-column `customer` sheet; dates become dates and text stays text. A reader written with the standard library, size and cell caps, hostile workbooks refused, fuzzed.
- **Start from a form.** No exports needed: describe the customer and its accounts, and the two files are made in the page, to analyse or download.
- **Another device.** Saved shows a QR code that opens the app on a phone (an encoder written here, checked with an independent decoder), and sends everything saved as one file sealed with the passphrase through the system share sheet; without a passphrase nothing is sent.
- **Run it anywhere.** `beyond90 app` serves the site from a folder or the new signed `beyond90-site.zip`: read-only, policy as a header, anti-framing, DNS-rebinding protection, loopback by default. A Dockerfile runs it as an unprivileged user; CI builds and probes the image. See `docs/self-hosting.md`.

## 0.25.0

The patterns behind a book, the quarter as slides, and a build anyone can verify.

- **Shared patterns across the book.** A new book view that links every customer to the security stories, onboarding blockers and missing capabilities it shares with others, and names the work that serves several at once: one fix guide (and product feedback) for a blocker three customers hit, one campaign for a story that leaves two customers exposed, one enablement session for the capability that would cover them, and the customer to start with. A click opens that customer's own map.
- **The map over time.** Compared with an earlier snapshot, Connections says which accounts were cleared, improved, became visible or got worse, which patterns appeared or were resolved, and highlights what is new on the map.
- **The executive review as PowerPoint.** Six slides written by the engine in the browser with the standard library: the summary, coverage then and now, what the quarter delivered, exposure, the two futures and the decisions to ask for. Also `exec-qbr --format pptx`.
- **A verifiable build.** Every build publishes `SHA256SUMS` and `build.json`; a separate least-privilege job signs them, and the extension packages, with build provenance. Help → "This build" shows the version and source commit and fingerprints every running file against the manifest; the extension carries its own.
- **Fuzzing.** New seeded fuzzing of every reader of outside data (news parsers, advisories, the browser analysis), alongside the existing loader fuzzing. It found and fixed three crashes: advisory entries that are not objects, list fields holding non-text values, and XML declaring an unknown encoding. DOCTYPE is now refused anywhere in a document, and parsers make links safe themselves.
- **OpenSSF Scorecard** on every push and weekly, with a public badge; SECURITY.md lists the repository settings that protect the account that publishes the code.

## 0.24.2

Layout that holds at every width, from a phone to a wide screen.

- **Charts are drawn at the size they are shown**, so their labels stay as large as the text around them instead of shrinking with a narrow column; they redraw when the space changes.
- **Columns follow the space the content actually has**, not the window: with the side rail open on a small laptop or a phone in desktop mode, cards stack instead of squeezing. Nothing overflows its card or the page (checked for every view at 390, 768, 1040 and 1440 pixels).
- **The overview reads top to bottom**: the score; what needs attention, as a grid of cards; where Yield is lost next to the same by stake; the plan next to the outlook if nothing is done; the biggest opportunities across the full width. The headline numbers sit in one row and wrap evenly.

## 0.24.1

- **Updates reach you.** The app used to keep serving the cached version until every tab of it was closed, so a reload showed the old interface. A new version is now downloaded in the background and offered at the top of the page; **Update now** switches every open tab to it at once, and the old copy is deleted. The browser checks for a new version each time the tab comes back into view. Tested end to end.

## 0.24.0

Where the problems meet, and the app in the browser toolbar.

- **Connections.** A new view that puts a customer's separate problems on one interactive map: the security stories that reach them, the protections that are off, the onboarding blockers, the accounts, their worst findings and the teams that own them. Beside it, in plain words, the few patterns worth a conversation: the capability that would close the most exposures, the stories nobody can check because the accounts are not connected, the team holding most of the risk, the single change that unblocks a group of accounts, and the accounts where several problems converge. Click an insight to light up its part of the map; click or press Enter on anything to see what it touches and jump to its view; drag, zoom, hide kinds. Same data, same picture. Built in `correlate.py`, drawn without a library.
- **Browser extension** for Chrome, Edge and Firefox (Manifest V3). The same app, opened from the toolbar, fully offline. No permissions, no content scripts, no network beyond its own files; the page's Content Security Policy is the manifest policy. The engine starts from the extension's own worker file, through the same Trusted Types policy, narrowed to that one file. Built reproducibly by `site/build_extension.py`, tested end to end in Chromium on every deploy, offered for download from Help. See `docs/extension.md`.

## 0.23.0

A new interface: easier to find your way, and it explains itself.

- **Four places, always in the same spot.** Start, the open customer (or your book), Saved and Help, in a sidebar. The customer's views are grouped by the question you are asking: where do they stand, what should I do, what do I say, and documents to share. Each view opens with one sentence on what it is for. The top bar shows who is open, with their Yield as a ring, and the date of their data.
- **Start** shows the three steps (choose the data, analyse, act), the examples, today's security news, and the customers you analysed before, one click each. The analyse button names what it will analyse.
- **Tooltips everywhere.** Every view, button, setting and number says what it does on hover or keyboard focus; screen readers hear the same text. Question marks next to numbers such as Yield open their definition.
- **Help.** Questions people ask, answered in plain words and searchable; a glossary of every term on screen; the keyboard; the privacy check.
- **A one-minute tour** after the first analysis, and any time from Help. Search (Ctrl or Cmd + K) also finds answers and terms.
- **Saved** gathers the history, protection with a passphrase, what is kept and moving between devices; a saved snapshot opens in one click.
- A typeface chosen for legibility (Atkinson Hyperlegible Next), served with the page; a cooler, quieter palette with one accent; the stylesheet rewritten as one file. Accessibility is audited on every place, the tooltip and the tour, in both themes.

## 0.22.0

Hardening: the data, the code and the supply chain.

- **Data.** With a passphrase, exported workspaces are sealed too (AES-256-GCM with the vault's key derivation); a sealed file opens on another device only with that passphrase and fails if altered. The page says how many snapshots are stored unencrypted until a passphrase is set. The app refuses to run inside another site's frame.
- **Correctness.** Account sources are validated; `platform` (the platform itself lists the account) is now documented, since the importers write it. Unused code removed: a configuration flag that did nothing, dead helpers, constants duplicated across modules, unused CSS and a sparkline nothing drew. The basic maturity level has its own badge colour.
- **Code quality.** mypy runs in strict mode on the whole package; Ruff adds the security (`S`), comprehension, simplification and Ruff-specific rules, with each security exception written on its line with its reason; ESLint lints the browser app and forbids `eval` and every HTML sink.
- **Supply chain.** Every workflow starts with no permissions and each job asks only for what it needs; checkouts keep no credentials; no event data is expanded into a script; Python tools are installed from lock files with hashes (`requirements/`), releases are built without fetching a build backend and published from a separate job; `zizmor` audits the workflows on every push. Tests pin all of this.
- **Docs.** Research notes about one vendor removed from the repository; screenshots retaken from the current app, with new ones for cloud news and the executive QBR; the security policy and threat model describe the collector, sealed exports, framing and the supply chain.

## 0.21.0

The customer's history, and the executive QBR built from it.

- **A history that keeps itself.** Every analysis of a customer is added to its history in the browser (on by default, one switch to turn it off). Input files only, the same data once, contacts and interactions only if you choose, sealed with the passphrase when one is set. The demo's earlier snapshot can be added at any time.
- **Executive QBR on demand.** Pick a quarter or custom dates: the period is compared with the last snapshot before it, and the review is written for a CISO: effective coverage and its four parts (connected, visible, protected, handled) with the trend, what the quarter delivered, the work done together, exposure today and the threats that touched the customer, what happens if nothing is done, next quarter's priorities and the decisions needed. No internal score or stage names. Preview in a sandbox, download as HTML (prints one page per section) or Markdown. Also `beyond90 exec-qbr DIR...`.
- The history's trend chart is redrawn reliably after an interrupted refresh.

## 0.20.0

Always aligned on cloud security news.

- **A daily feed from public sources.** `beyond90 feeds` reads the Kubernetes official CVE feed, AWS and GKE security bulletins, the Open Cloud Vulnerability Database, the Microsoft security update guide and the catalogue of known exploited vulnerabilities, plus any RSS, Atom or JSON Feed you add (`--sources`). It keeps what is about the cloud and recent, merges items that share a CVE into one story with every source, adds the exploit probability (EPSS), and gives every story a severity with its reason: known exploited is critical. The result is an advisory feed every other command already reads.
- **Published with the site.** The Pages workflow collects it every morning and publishes it next to the app; "Use today's cloud news" loads it and keeps it current. Same origin, same strict policy; customer data never leaves the browser.
- **Matched to the right estates.** A story about one provider's service touches only that provider's accounts; a Kubernetes CVE touches every cluster, wherever it runs.
- **For one customer:** badges (known exploited, EPSS, new, ransomware), sources, and a **security briefing** ready to send, without internal scores; also written by automated runs as `security-briefing.md`.
- **For the book:** a "Cloud news" view with every story against every customer, ranked by known exploitation and by customers left uncovered, with filters by provider, exploited, uncovered and new.
- A known exploited story on uncovered accounts moves the customer up the week, leads the news part of the call, and raises one alert in automated runs.
- Each source reports what it read, kept and dropped, and the newest date it saw, in the feed and on the command line.
- Safe reading: https only, redirects only to configured hosts, size and time caps, XML with entity declarations refused, everything reduced to plain text.

## 0.19.0

What the work was worth, who has to move, and what was agreed.

- **Value receipt.** With an earlier snapshot, one page of what moved between the two dates: accounts connected and the monthly spend they bring under watch, findings closed by severity, findings that gained an owner and a decision, capability activations, the points earned by the customer's own work kept apart from the bar moving, promises kept. Each logged touch is listed with the outcomes of the same kind in the 21 days after it: followed, not caused. And it ends with what did not move. In the browser, from `beyond90 receipt DIR --since OLD --format html|markdown|json`, and written by every automated run that has a previous snapshot as `value-receipt.html`. In the demo: 7 accounts connected, 37 findings closed (4 critical).
- **Team digests.** The estate split by the customer's own teams and ranked by what is at stake on their side (spend not connected, critical findings, blocked connectors): their accounts, blockers with causes in plain words, their findings, their dated events, at most three asks, and a message addressed to their contact, with no internal scores. A champion forwards one note per team instead of one list for everyone. In the browser and from `beyond90 teams DIR`.
- **Recap after the call.** In "Prep a call", the follow-up email is drafted from the agenda, the promises we owe and the next steps typed in (what, who, by when). Copy or download; nothing is sent.
- Automated runs skip an output that is empty (for example the receipt on the first run) instead of writing an empty file.

## 0.18.0

Two questions most tools leave to intuition.

- **If nothing is done.** The estate is scored again on future dates with only what the data already dates: secrets that expire, accepted risks that reach their review date, unowned findings that age into the triage window, deadlines, promises, the cadence, the renewal. Every event has a date, whose move it is, and, where the score moves, its exact effect in points (the day before against the day itself). A 90-day curve, the level at 30, 60 and 90 days, one sentence for the call, a CSV and a calendar file. It invents nothing: it is the floor of what waiting costs.
- **Weighted by what is at stake.** Yield again, with accounts weighted by spend and findings by severity and exposure, next to the count. In the demo, 90% of accounts but 79% of spend are connected: the production accounts held back are few and expensive.
- Both reach the overview, the call brief ("What breaks if we wait", "Where the gap matters"), the week plan (points lost within seven days), the book (90 days if idle, per customer) and the customer's status page ("Coming up if nothing changes").
- The demo's held-back production accounts now carry production-sized spend; nothing else in the examples changes.

## 0.17.0

Onboarding, for the call with the customer.

- **Commands to check.** Every cause in the connector catalogue now has read-only commands (`aws`, `az`, `gcloud`, `kubectl`) the customer can run to confirm it, shown in each wave and in the error explainer, ready to copy. Known values such as the account are filled in; anything that is not a plain identifier stays a placeholder, so nothing in the data can turn into shell syntax. A test refuses any command that could change something.
- **Progress since last time.** With an earlier snapshot, onboarding shows how many accounts completed, moved forward or went back, which causes were fixed and which appeared, which connectors broke, the completions per week, and the date everything is complete at that pace.
- **A status page for the customer.** A self-contained HTML page (or Markdown, or text to paste in an email): what is done, what waits on which of their teams with the steps and the commands to check, what is on the vendor's side, credentials to rotate, recommendations for the connectors. No internal scores. From the view, from `beyond90 onboarding DIR --customer-page --since OLD --format html`, and written by every automated run as `onboarding-status.html`.
- The earlier example snapshot has its own connector history, so the demo shows real progress.

## 0.16.0

Onboarding: where connectors stall, why, and what unblocks them.

- **Stages.** A new optional file, `connectors.csv`, places every account on a stage: discovered, connector deployed, signs in, can read, first scan done, complete and fresh. Without it, onboarding is read from the account list.
- **Causes.** A catalogue of about thirty causes for AWS, Azure, Google Cloud, Kubernetes clusters and runtime sensors (guardrails, external IDs, consent, conditional access, management group scope, disabled APIs, organization policies, service perimeters, opt-in regions, customer-managed keys, private API servers, RBAC, pod security and admission policies, egress proxies, image pulls, kernels), each with an owner, steps and a way to verify.
- **Unblock in this order.** Blocked accounts grouped by cause and ordered by accounts unblocked per hour; organization-level fixes counted once; several undeployed accounts become one organization-level deployment. Each wave copies as a ticket.
- **Healthy versus counted.** The connectors that actually work, next to what L1 counts, and the accounts in between.
- **Time to connect**, stuck accounts, **expiring secrets**, and a **security review of the connectors** themselves with STRIDE labels.
- **Explain a connector error**: paste a message, get the cause and the fix, in the page or with `beyond90 triage`.
- **Pre-flight checklist** for a kickoff, in the page or with `beyond90 preflight`.
- **Book mode**: onboarding for every customer and the causes they share. The call brief, the week plan and the alerts take onboarding into account; `connectors` is a target for automation; `beyond90 onboarding DIR` prints the plan.

## 0.15.1

A visual pass on the browser app. No change to any number.

- **First impression.** A landing with a live preview of the dashboard, four short reasons to use it, and the three examples as cards instead of buttons.
- **App shell.** A result header with the customer, level and confidence; a left rail with icons and groups (Customer, Plan and review, Documents; Your book) that becomes a scrolling bar on small screens; a softer, deeper palette with a gradient button, glow and shadows.
- **Motion.** Cards rise in, the stage bars grow, the examples pulse while the engine loads; all of it off when the system asks for reduced motion.
- **Icons.** A small line-icon set built without parsing HTML, so Trusted Types still hold.
- **Accessibility.** One h1 per screen with a real heading order, and every selected control above 4.5:1 contrast, checked in light and dark on every view.

## 0.15.0

For a TAM with a book to run every week, and a browser app that is harder to attack.

- **Tiers and cadence.** `tier` classes top, mid and other (default every 7, 14 and 30 days; `cadence_days` overrides). A new personal file, `interactions.csv`, logs calls, meetings, emails and advisories with a next step; the cadence is measured against it.
- **This week.** In book mode, the customers in the order the week needs them, each with a day, the hours it deserves, and the plain-sum reasons for its place; the week says so when it does not fit.
- **Prep a call.** An agenda in the order that earns attention (what we owe, what changed, news, leaks, questions, renewal, growth, next steps), copy or download as Markdown; **Log a touch** adds a line to the log and re-runs.
- **News.** Add a JSON advisory feed and each advisory is matched to what the customer has inventoried: exposed, covered, not covered and cannot be assessed, with a plain-words note to send. Feeds that do not fit a catalogue are skipped with a warning.
- **Growth only when earned.** Capacity, expand, broaden, diversify and threat signals appear as questions; a trust gate says why a commercial conversation is not yet appropriate.
- **Automation.** `[advisories] path` in `beyond90.toml` loads the feed on every run, and a run writes `call-prep.md`.
- **Security.** Trusted Types are enforced and every `innerHTML` is gone, with a test that fails on any new unsafe sink; optional passphrase protection of saved data (PBKDF2-SHA-256 with 600,000 rounds, AES-256-GCM per snapshot, key in memory only, locked after 15 idle minutes); actions pinned to commit SHAs, Dependabot, CodeQL, an npm lock file with integrity hashes installed by `npm ci --ignore-scripts`, and releases with an SBOM, checksums and a signed provenance attestation. `docs/threat-model.md`.

## 0.14.0

A new browser app. The report is still there; the app is now a dashboard you work in.

- **Overview.** A Yield gauge with the legacy figure marked on it and the checkpoints at 90, 95 and 98; a waterfall of what each stage costs; a "needs attention" list drawn from the data (critical findings and the pace of closing them, renewal, units no source has seen, severity downgrades near a deadline, under-used licences); the five best opportunities; the planned curve.
- **Explorers.** Actions (search, stage filter, steps, "copy as ticket"), accounts (provider, owner, gaps, not connected, critical findings; what is not inventoried and which capabilities are off) and open findings (severity, status, owner, decision), each sortable, paged and exportable as CSV. Exported cells that start with `=`, `+`, `-` or `@` are prefixed so a spreadsheet cannot run them.
- **Plan and what-if.** Sliders for hours, horizon and realization recompute the plan in the engine, against the original as a dashed line, with a timeline of what gets done and when and what the plan cannot close.
- **Maturity, renewal and trust, changes.** The ladder with every check, adoption by use case and framework function, renewal signals, licences, the universe estimate, contacts, and a contribution chart that sums exactly to the change since an earlier snapshot.
- **Portfolio map.** In book mode, a heat map of every customer by stage with ARR, plan and level, and where to look first.
- **Command palette** (Ctrl or Cmd + K), number keys for views, a five-line summary to paste into chat, print styles, and a light, dark or system theme.
- **Engine.** `analyze` returns a structured `dashboard` (plan by week, per-account and per-finding rows with the gaps behind them, attribution, renewal, ladder, forecast, drift, candor items) and a `plan` call serves the sliders. Lists are capped and say so.
- **Quality.** Browser tests drive every view, a hostile customer name is checked in each, and the accessibility audit passes in light and dark. Python tests tie the dashboard to the score it was drawn from.

## 0.13.0

Hardening: no new features, a lot fewer ways to fall over.

- **Files from any program.** CSV and TOML are read as UTF-8, UTF-8 with a byte-order mark or UTF-16; a file that is not valid UTF-8 is read as Windows-1252 with a warning instead of a traceback; NUL bytes, oversized fields and malformed CSV are errors with a file and line. `NaN`, `inf` and huge numbers are refused as numbers. A `[customer]` or `[settings]` that is not a table is an error.
- **Fetching.** Truncated bodies, dropped connections, non-HTTP answers, absurdly nested JSON, cursors that are not text and odd `Retry-After` values end in a `FetchError` naming the source, never a traceback.
- **Pipeline operations.** One run at a time per state directory (a lock that a crashed run cannot leave behind for good); a damaged cache, run log or snapshot folder is ignored instead of stopping the run; the cache and the dated output folder are written whole or not at all; `[state] keep_snapshots` and `keep_outputs` prune old folders (history and run log are kept); unwritable or full disks give a message that says what to check.
- **Browser app.** A workspace file is refused above 1000 snapshots; snapshots with wrongly typed fields are rejected, not half trusted; a `__proto__` key cannot change a merged object; a crashed engine is replaced by the next request; a full browser store says so in words.
- **Tests.** Seeded fuzzing of the inputs (300 cases by default, `B90_FUZZ_CASES=6000` for more; none crashed after the fixes), network chaos tests, a differential test of L1 to L4 against an independent reimplementation that reads the raw CSV, lock and retention tests, release checks (versions agree; the wheel carries the data files and installs and runs on its own).
- **Documented limit.** Planning is quadratic in the size of the estate: about 15 s at 500 accounts and 5,000 findings, about 3 minutes at 5,000 accounts and 50,000 findings. See `docs/operations.md`.

## 0.12.0

Automation: no one has to export a file.

- **Connectors.** `beyond90.toml` declares sources (REST APIs, cloud CLIs, drop folders) and how each record maps to the columns the engine reads; a new vendor needs a mapping, not code. Presets for the AWS, Azure and GCP CLIs. Four pagination styles, token from an environment variable, host allow-list including redirects, https, no shell, size, time and page caps, retries with `Retry-After`.
- **`sync`.** Merges lists by id keeping every source tag, a last good copy per source when one fails (reported stale with its age), failure when a required column reads nothing, orphan rows dropped and counted, hand-kept rows in `state/manual`, atomic writes.
- **`run`.** The whole pipeline: collect, score, compare with the previous snapshot found by itself, write the report, QBR, success plan, summary, roadmap and JSON, keep history, export a workspace file the browser app imports, alert on what changed, notify a webhook.
- **Alerts** only when something changed or needs a person.
- **`schedule`** prints a GitHub Actions workflow, a cron line or systemd units; `check-config` validates without touching anything.
- Tests against a local fake API: pagination, auth, retries, redirects, outages, merging, alerts, webhook, secrets never in output, no shell injection, workspace accepted by the browser's own checks.
- Not verified against any real vendor API or CLI; said in the docs.

## 0.11.0

- **Path to the next level.** The ladder now says when: the first week from which the stage checks for the next level keep passing, and the hours spent to get there, from the roadmap (dip included). Checks the roadmap cannot move (findings past their deadline, licence use, relationships) are listed as outside it.
- **Input drift.** With `--since`, the report says whether the two exports differ in ways that look like artefacts: units that vanished without being decommissioned, a much smaller inventory, open findings that disappeared, a comparison that is not older. Check them before presenting a change.
- Both appear in the report, the QBR and the browser app.

## 0.10.0

Informed by a survey of existing products (`docs/research/landscape.md`).

- **Maturity ladder.** Bronze, silver and gold from checks; a customer is at a level only when every check at that level and below passes; the next checks to pass are listed with the action that closes each; unmeasured checks neither pass nor block and mark the level provisional. Shipped rubric in `data/rubric.json`, replaceable per profile; level names are fixed. Shown in reports, the QBR, the portfolio table and the browser app.
- **Adoption by use case and by NIST CSF 2.0 function.** Modules carry `use_case` and `csf` tags (both profiles). Not compliance: stated in the output.
- **Renewal readiness.** `renewal_date` and `renewal_window_days`; a checklist of leading indicators with evidence, ARR on the line, and expansion headroom; a Renewals section in the portfolio with revenue at risk. No predicted probability.
- **Success plan.** `beyond90 successplan`: outcomes, measures, milestones, owners, decisions, commitments, risks, signatures. Nothing private. A tab in the browser app.
- Example customers gain invented renewal dates; the QBR gains a use-case section and a ladder sentence.
- Tests: ladder gating and validation, view arithmetic, renewal bands, success plan privacy, plus properties on random estates.

## 0.9.0

Vendor-neutral by design: one engine, a catalogue profile per kind of security product.

- **Profiles.** `cnapp` (the default, unchanged) and a new `endpoint` profile for endpoint protection, with its own asset types, capabilities, playbook overrides and words ("site", "endpoint assets"). Choose with `--profile` or `profile = "..."` in `customer.toml`; `beyond90 profiles` lists them; `--catalogue-dir` still loads your own. A mismatch between a flag and the file is an error, a mixed-profile portfolio or book is refused, and every score records its profile and catalogue hash.
- **Terms.** Text the engine writes follows the profile's words for the unit of coverage; a customer's own text is never rewritten. Cloud output is byte-for-byte unchanged apart from the provenance line.
- **Browser app.** Reads the profile from the data, shows it, and has an endpoint demo.
- **Docs.** `docs/profiles.md` (shipped profiles, how to write one, how identity, SIEM, email, vulnerability, network and application security map). Vendor research moved to `docs/research/` as a case study; vendor names removed from the product's own docs, interface and code comments.
- Example: `examples/profiles/endpoint/acme-endpoint` (invented, generated).

## 0.8.1

Found by an audit of the whole project.

- **An estate with no active account is refused** by `score`, `report`, `qbr`, `plan`, `explain`, `universe`, `forecast`, `book`, `portfolio` and the browser app, with an explanation. Before, it scored 100% on every stage. `validate` and `init` still accept it. **Behaviour change.**
- **Free text is cleaned on load**: line breaks, control characters and direction-changing characters become spaces, and `|` becomes `¦`, so a name can no longer split a Markdown table or inject a heading. A warning counts the values adjusted.
- **Attribution is exact when a stage is zero.** The two parts used to miss the total by up to half a point in that case; they are now scaled to add up exactly, with a note that the split is approximate.
- Python 3.11 compatibility restored (an f-string reused its own quote character).
- "1 customers" corrected.
- New tests: seeded random estates (bounds, determinism, row order, plan, attribution), hostile input (parsed HTML audit, Markdown tables), the browser's rendering of hostile text, the empty-estate refusal.
- `THIRD_PARTY.md` for the software bundled in the browser app; README status, limits and guide brought up to date.

## 0.8.0

- **How far to trust this number.** `Score.quality`: checks on the inputs (independence of the account list, inventory and activation coverage, freshness of the findings export, empty owner and decision columns, very few accounts, forgotten accounts) and an overall confidence of high, medium or low. Shown in the report and in the browser app. It never changes Yield.
- **Browser app: a whole book.** Drop a folder of customer folders (or try the book demo): portfolio table, shared patterns, and one budget of hours spent where it adds the most weighted Yield. "Open" jumps to a customer's own report.
- Accessibility: axe-core runs in the browser test in light and dark with no violations; contrast, labels and landmarks fixed.
- Screenshots of the app in `docs/img/`.

## 0.7.0

Structure, from *Designing Data-Intensive Applications* (see `docs/architecture.md`).

- **Provenance.** Every score carries the hash of its inputs, the engine version, the catalogue hash and the ceiling; reports print it. New command `fingerprint`.
- **Tolerant reader.** Unknown CSV columns and `customer.toml` keys are ignored with a warning and a "did you mean". `schema_version` in `customer.toml`: newer formats are refused with advice.
- **Percentiles.** Time to remediate is reported as median and 90th percentile (mean kept in the JSON). The QBR line changed accordingly. **Behaviour change in the report text.**
- **Browser app, local-first.** The engine runs in a worker (cancel, restart, no frozen page). Snapshots of the inputs can be saved in the browser (IndexedDB), compared with an earlier snapshot, exported and imported. Merge is set union and idempotent; imports are verified against their content hash; unknown fields survive. Contacts and commitments are left out unless you opt in.
- **Offline.** A service worker caches the whole app per build; a new build waits for old tabs to close.
- **Self-check.** A button that proves the page and the worker cannot reach another site.
- Tests: Node tests for the workspace model, a cross-language fingerprint check, and a larger browser test (offline, cancel, persistence, import/export, tampering).

## 0.6.0

- Browser app (`site/`): the engine runs in the page through Pyodide; drop a folder or try the demo, get the report, QBR, roadmap and JSON. Nothing is uploaded; a strict Content Security Policy allows the page's own origin only.
- `beyond90.web`: one call that returns every output for a directory or a mapping of files.
- GitHub Pages workflow: builds the site, runs a Chromium smoke test, deploys. See `docs/app.md`.
- Error messages from the browser path name files, not temporary folders.

## 0.5.0

- Relationship layer: optional `contacts.csv` and `commitments.csv`; trust index per contact, band, limiting factor, reliability measured from promises, coverage and gaps.
- Candor ledger: what to say plainly, with evidence; shown in the report and the five most important in the QBR.
- Expansion typed as Expand, Broaden or Diversify from who you know on each team.
- Playbooks gain an offer, an opening question and a commitment; new relationship playbooks (find a sponsor, reconnect, widen, introduce, close commitments, improve a component).
- QBR rewritten as engage, listen, frame, envision, commit, with a private "for you only" section.
- Settings `contact_stale_days` and `commitment_lookback_days`. No behaviour change when the new files are absent.

## 0.4.0

- `import` (aws-org, azure, gcp, csv) and `reconcile`: build `accounts.csv` from native exports, union by account id, report conflicts, idempotent.
- `book`: one budget of hours across many customers, compared with an equal split and an ARR-proportional split.
- `radar`: customers that should hear about a release; exposure and coverage for threats from a JSON feed.
- Missing `inventory.csv` or `activations.csv` now means "not measured" for L2 and L3 instead of zero. **Behaviour change.**
- Planner: large actions are planned in weekly batches; cached stage ratios; a 500-account customer plans in about 5 seconds.
- `py.typed`, mypy and ruff clean, tests run on Python 3.11, 3.12 and 3.13.

## 0.3.0

- Simulator and week-by-week planner that shows the J-curve of connecting new accounts.
- Exact attribution of a change in Yield: customer versus bar (log-mean Divisia index).
- Estimate of accounts no source has seen (Chao 1987 lower bound) and a pessimistic L1.
- Monte Carlo forecast of reaching zero critical and of breaking it.
- Commands `plan`, `explain`, `universe`, `forecast`.

## 0.2.0

- Scoring engine (L1 to L4, Reach, entitlements, outcomes, anti-gaming check), validated CSV/TOML loader, versioned catalogues.
- Ranked actions from a playbook catalogue, SQLite history, portfolio view, QBR draft, self-contained HTML report.
