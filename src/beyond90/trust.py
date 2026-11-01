"""Expansion done as a trusted advisor: what kind of cross-sell is this, and what does it cost in trust?

*The Trusted Advisor* (ch. 21) separates three situations that all get called
"cross-selling" and that feel different to the customer, because trust is
personal and does not transfer from one person or one product to another:

* **Expand**: a new capability for people who already trust you. The risk is
  asking them for a favour with little in return, and passing them to a
  colleague they have never met.
* **Broaden**: the same service for new people. The existing client has to be on
  your side of the table, and needs a reason of their own to introduce you.
* **Diversify**: a new capability for new people. Two new relationships at once:
  the lowest starting trust, and the one most often attempted as if it were Expand.

The tool knows whether the capability is new for the people involved (the
playbook's ``offer``) and whether you have a contact in their team (``contacts.csv``).
The notes are our own wording of the chapter's lessons, not its text.
"""

from __future__ import annotations

from collections.abc import Iterable

NOTES = {
    "expand": "A new capability for people who already trust you. Present it through them, tied to a problem they have named, and do your homework "
              "before bringing in a colleague; do not just hand over a business card.",
    "broaden": "The same service for people who do not know you. Trust does not travel from your champion to them. Ask for an introduction, say what is in it "
               "for them and for the champion, and arrive having learned about the team on your own time.",
    "diversify": "A new capability for new people: two new relationships at once, and the lowest trust you will start from. Build the relationship first, "
                 "give something useful before asking, and do not treat the institutional relationship as if it carried over.",
}


def classify(offer: str, people: Iterable[str], contact_teams: set[str], have_contacts: bool) -> str:
    """Return ``expand``, ``broaden``, ``diversify`` or ``""`` (no cross-sell: existing offering, known people)."""
    if not offer or not have_contacts:
        return ""
    group = [p.strip().lower() for p in people if p and p.strip()]
    known = bool(group) and sum(1 for p in group if p in contact_teams) / len(group) >= 0.5      # most of the people are ones you already work with
    if offer == "new":
        return "expand" if known else "diversify"
    return "" if known else "broaden"
