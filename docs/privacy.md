# Sharing without the names, retention and erasure

Everything here happens in your browser. Nothing is sent anywhere.

## Sharing levels

The **Share** control at the top chooses what leaves the page when you copy or download a text:

| Level | What is replaced |
|---|---|
| Full names | nothing |
| People hidden | owners and contacts: Person 1, Person 2… |
| Pseudonyms | the customer (Customer A), people, teams (Team 1) and accounts (Account 1) |

At the second and third level you see a **preview** before anything leaves: the text as it will leave, how many names were replaced, and what the page can still see (names the level does not cover, and anything shaped like an email address). You then choose to continue or cancel. File names get the alias too.

The aliases are kept **on this device** (sealed with your passphrase if you set one), so the same name gets the same alias next week. Under *Saved → Sharing and retention* you can paste a text that came back with aliases in it, for example an answer from a model, and **put the real names back**.

Not changed on purpose: the sealed workspace backup, and the starter and interaction files you make for your own use. A PowerPoint file cannot have its names replaced, so it is refused at the pseudonym levels: download the Markdown or HTML version.

### What this does not do

- **A pseudonym is not anonymity.** Sizes, dates, counts and the way a customer is set up can still point to them.
- It replaces names the page was told about (customer, owners, contacts, teams, accounts, connectors). A name typed in a free note, or a person the files never list, is not replaced. Read the preview.
- Aliases are ordinary words: if an account id is a word that also appears in the text, it is replaced there too. In an HTML file, an id that equals a markup word could damage the file.
- The MCP server has no pseudonym mode: it is read only and has no place to keep aliases.
- Aliases, retention dates and the export log stay on the device and are not in an exported workspace.

## Retention

Under *Saved → Sharing and retention*, set a **keep-until** date for each customer held on this device. The page lists the customers whose date has passed and those within 30 days. It never deletes by itself.

## Erasing one customer

*Erase all* removes everything this browser holds for that customer: its snapshots, recorded outcomes, promises, keep-until date, alias entries and entries of the export log. Then it reads the stores again and tells you how many records for that customer it can still read (it should be zero). While saved data is locked it refuses, because it could not see what to remove.

You can download an **erasure record**: what was removed, the second look, and the list of times something left the page for that customer. Those copies, the files you downloaded and the text you copied, are wherever you put them; this page cannot reach them, nor other devices, nor traces the browser may keep until it compacts its own database.

The record is a text the page wrote about itself. It is **not independent proof**, and it is not stored.

## Storage keys

Sealed outcomes, promises, retention dates and the export log are stored under random slots rather than under their own ids (which contain the customer's name), so the database alone does not say who has records here. Records made before 0.32 are moved the first time you unlock.
