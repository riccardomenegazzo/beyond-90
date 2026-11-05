// The words of the interface that explain it: what each view is for, the questions people ask, the terms they meet,
// and the short tour. Kept apart from the code that draws things, so they can be read and edited as text.

/** Every view, grouped by the question a TAM is asking when they open it. `tip` is one sentence on what it is for. */
export const CUSTOMER_NAV = [
  { question: "Where do they stand?", views: [
    { id: "overview", label: "Overview", icon: "overview", tip: "The score, where it is lost, and what needs attention first." },
    { id: "connections", label: "Connections", icon: "layers", tip: "Where the separate problems meet: security stories, gaps, accounts, findings and owners on one interactive map, with what it means." },
    { id: "accounts", label: "Accounts", icon: "accounts", tip: "Every cloud account and cluster: connected or not, what is visible, what is switched on." },
    { id: "findings", label: "Findings", icon: "findings", tip: "Open findings and whether each one has an owner and a decision." },
    { id: "onboarding", label: "Onboarding", icon: "onboarding", tip: "Connectors that are stuck, why, and the one change that unblocks each group." },
    { id: "maturity", label: "Maturity", icon: "maturity", tip: "The bronze, silver, gold ladder and the checks between here and the next level." },
  ] },
  { question: "What should I do?", views: [
    { id: "actions", label: "Actions", icon: "actions", tip: "Every gap turned into a task, ranked by points gained per hour of work." },
    { id: "planview", label: "Plan and what-if", icon: "planview", tip: "Your hours per week turned into a week-by-week plan; move the sliders to see the effect." },
    { id: "outlook", label: "If nothing is done", icon: "outlook", tip: "What breaks on which date if nobody acts: expiring secrets, ageing findings, slipping promises." },
    { id: "teams", label: "Teams", icon: "accounts", tip: "The customer's own teams, ranked by what is at stake on their side, each with a message ready to send." },
  ] },
  { question: "What do I say?", views: [
    { id: "prep", label: "Prep a call", icon: "prep", tip: "The agenda for the next call in the order that earns attention, and the recap afterwards." },
    { id: "news", label: "News", icon: "news", tip: "Security news that touches this customer's resources, with a briefing you can send." },
    { id: "value", label: "Value receipt", icon: "renewal", tip: "What improved since an earlier snapshot, and the work that came before it." },
    { id: "execqbr", label: "Executive QBR", icon: "doc", tip: "A quarterly review for the CISO, built from this customer's saved history." },
    { id: "renewal", label: "Renewal and trust", icon: "renewal", tip: "Signals that predict the renewal, and how reliable we have been on our promises." },
    { id: "changes", label: "Changes", icon: "changes", tip: "What moved since an earlier snapshot, split between the customer's work and new capabilities." },
  ] },
  { question: "Documents to share", views: [
    { id: "report", label: "Report", icon: "doc", tip: "The full report as a page you can save or print." },
    { id: "qbr", label: "QBR draft", icon: "doc", tip: "A review draft in Markdown, structured to end with decisions." },
    { id: "plan", label: "Success plan", icon: "doc", tip: "Outcomes, milestones and owners the customer can sign." },
    { id: "roadmap", label: "Roadmap", icon: "doc", tip: "The plan week by week, with the dip before the gain." },
    { id: "summary", label: "Summary", icon: "doc", tip: "A short written summary for a message or a ticket." },
    { id: "json", label: "Data (JSON)", icon: "doc", tip: "Every number behind the views, for your own tools." },
  ] },
];

export const BOOK_NAV = [
  { question: "Your week", views: [
    { id: "week", label: "This week", icon: "week", tip: "Which customers to contact this week, in order, with the reason and the call prepared." },
    { id: "bookmap", label: "Portfolio map", icon: "bookmap", tip: "Every customer's four stages side by side, so the weak spot of the book stands out." },
    { id: "bookonboard", label: "Onboarding", icon: "onboarding", tip: "Stuck connectors across customers, and the causes they share." },
    { id: "booknews", label: "Cloud news", icon: "news", tip: "Each security story against every customer: who is exposed and who is not covered." },
  ] },
  { question: "Documents to share", views: [
    { id: "portfolio", label: "Portfolio", icon: "doc", tip: "The portfolio in Markdown: customers, levels and shared patterns." },
    { id: "book", label: "Where your hours go", icon: "doc", tip: "One budget of hours split across customers for the most coverage." },
    { id: "bookreport", label: "Book report", icon: "doc", tip: "The whole book as a page you can save or print." },
  ] },
];

/** Plain-language answers to what people ask. Each answer is short; links point to the place in the app. */
export const FAQ = [
  { group: "Getting started", items: [
    { q: "What does Beyond 90 do, in one sentence?",
      a: "It reads what a security customer really uses, shows where their coverage leaks, and tells you what to do and what to say next, for one customer or your whole book." },
    { q: "What do I need to start?",
      a: "A folder with the customer's files: customer.toml and accounts.csv at least, plus inventory, activations and findings if you have them. Not ready yet? Open one of the examples on Start and look around; nothing you do there touches real data.",
      link: { place: "start", text: "Go to Start" } },
    { q: "I look after ten customers. Do I load them one at a time?",
      a: "No. Choose a folder that contains one folder per customer and Beyond 90 opens your whole book: who to call this week, the portfolio map, and the news across all of them." },
    { q: "Why does the first analysis take a few seconds?",
      a: "The engine is real Python running inside your browser. The first time, the browser loads it; after that it is cached and the app even works offline." },
  ] },
  { group: "The numbers", items: [
    { q: "What is Yield, and why is it lower than the number in my console?",
      a: "Most consoles count how many accounts are connected. Yield also asks whether each one is fully visible, has its protections switched on, and has its findings owned. It multiplies those four, so a gap anywhere shows. The console's number is shown next to it as the legacy metric, so the difference is visible, not hidden." },
    { q: "The score went down and nobody changed anything. Why?",
      a: "Usually one of three things: a new capability was released and raised the bar, findings aged past the triage window without an owner, or a connector stopped working. Changes splits any movement into the customer's work and the bar moving." },
    { q: "How much can I trust these numbers?",
      a: "Every result carries a confidence level based on checks on the inputs (missing files, stale dates, odd values). The plan and the forecasts are models: they are labelled as such, and their limits are written in the documentation." },
  ] },
  { group: "Daily work", items: [
    { q: "I have a call in five minutes. Where do I look?",
      a: "Prep a call. It gives the agenda in the order that earns attention (what we owe first, then what changed, then the news), and after the call it drafts the recap from what you agreed." },
    { q: "A new vulnerability is in the news. Does it touch my customers?",
      a: "Use today's cloud news on Start, then open News (one customer) or Cloud news (your book). Each story says how many accounts are exposed, covered or cannot be assessed, and comes with a briefing you can send as it is." },
    { q: "How do I build a QBR without spending a day on it?",
      a: "Keep analysing the customer as you go: every analysis is added to their history. When the review is due, open Executive QBR, pick the quarter and build it. It is written for a CISO, without internal jargon." },
    { q: "Can I use it as a browser extension?",
      a: "Yes, for Chrome, Edge and Firefox. Help has the download. It is the same app opened from the toolbar in a tab of its own: it asks for no permissions, cannot see the pages you visit and cannot reach the internet at all. Its news is the one collected when it was built; the website refreshes it every day." },
    { q: "What is the Connections map for?",
      a: "Each view looks at one kind of problem. Connections puts them together: which security stories reach which accounts, which protections are off there, which connectors are stuck, which critical findings sit on them and which team owns them. On the left it says what the picture shows, in plain words: the capability that would close the most exposures, the accounts nobody can check, the team that holds most of the risk. Click an insight and its part of the map lights up." },
    { q: "How do I show the customer what my work was worth?",
      a: "Choose an earlier snapshot in “Compare with” at the top of the customer, then open Value receipt: accounts connected, findings closed, decisions taken, and what still has not moved." },
    { q: "A connector is stuck and the error makes no sense.",
      a: "Open Onboarding and paste the error in “Explain an error”. You get the likely cause in plain words, who has to fix it, and read-only commands to confirm it." },
  ] },
  { group: "Your data and privacy", items: [
    { q: "Where do my files go?",
      a: "Nowhere. They are read inside this tab and analysed by the engine in this tab. The page is not allowed to send data to any other site, and “Check that nothing leaves” on this page proves it.",
      link: { place: "help", anchor: "privacy", text: "Run the check" } },
    { q: "Is anything saved?",
      a: "Your analyses are kept in this browser, on this device, so you can compare and build reviews later. Protect them with a passphrase in Saved: everything, exports included, is then encrypted.",
      link: { place: "saved", text: "Open Saved" } },
    { q: "I forgot my passphrase.",
      a: "There is no way back, by design: nobody else has the key. Keep an exported workspace as a backup, and you can import it again with the same passphrase." },
  ] },
];

/** The terms that appear on screen, defined once. The ids are used by the small question marks next to them. */
export const GLOSSARY = [
  { id: "yield", term: "Yield", text: "The share of the customer's estate that is truly covered: connected × visible × protected × handled. It is the main number." },
  { id: "legacy", term: "Legacy metric", text: "The number most consoles show (accounts connected over accounts listed). Shown next to Yield so the gap is visible." },
  { id: "reach", term: "Reach", text: "How much of the customer's organisation uses the platform: teams with access who actually log in." },
  { id: "connected", term: "Connected", text: "Accounts and clusters the platform reaches, out of all the customer has." },
  { id: "visible", term: "Visible (inventoried)", text: "Resource types the platform can see in those accounts, out of the types that exist there." },
  { id: "protected", term: "Protected (controls on)", text: "Protections switched on where they apply, out of all the places they apply." },
  { id: "handled", term: "Handled (findings decided)", text: "Findings that have an owner and a decision (fix, accept, exception, false positive), out of those past the triage window." },
  { id: "level", term: "Maturity level", text: "Basic, bronze, silver or gold. One failing check holds the level, so the next step is always concrete." },
  { id: "weighted", term: "Weighted by spend and exposure", text: "Yield again, with expensive accounts and internet-exposed findings counting more. It shows when a few large gaps matter more than many small ones." },
  { id: "confidence", term: "Input confidence", text: "How complete and consistent the files are. Low confidence means a number may mislead; the inputs view says why." },
  { id: "snapshot", term: "Snapshot", text: "The customer's files as they were on one date. Comparing two snapshots explains what changed." },
  { id: "book", term: "Book", text: "All the customers you look after, opened together." },
  { id: "wave", term: "Wave", text: "A group of stuck connectors with the same cause, so one change unblocks all of them." },
  { id: "kev", term: "Known exploited (KEV)", text: "A vulnerability attackers are already using, according to the public catalogue of known exploited vulnerabilities." },
  { id: "epss", term: "EPSS", text: "The estimated probability that a vulnerability is exploited in the next 30 days." },
  { id: "triage", term: "Triage window", text: "The days a new finding has before it should have an owner and a decision. After that it counts against Handled." },
];

/** The short tour, shown once after the first analysis and any time from Help. Each step points at one thing. */
export const TOUR = [
  { target: "#context", title: "Who you are looking at", text: "The customer that is open and the date of their data. The ring is their Yield." },
  { target: "#tabs", title: "Views, grouped by your question", text: "Where do they stand, what should I do, what do I say. Hover any view to see what it is for." },
  { target: "#kpis", title: "The numbers that matter", text: "Hover a number, or the question mark next to it, for what it means." },
  { target: "#compare", title: "Compare with an earlier date", text: "Pick an earlier snapshot and every view explains what changed since then." },
  { target: "#open-palette", title: "Jump anywhere", text: "Press Ctrl K (Cmd K on a Mac) to search views, actions and answers." },
  { target: "[data-place=help]", title: "Help is always here", text: "Questions and answers, the glossary, and this tour again." },
];
