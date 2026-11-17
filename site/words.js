// Counted nouns in plain English: "1 finding", "3 findings", never "finding(s)". Same rules as beyond90/words.py.
const IRREGULAR = { person: "people" };
export function plural(word) {
  if (IRREGULAR[word]) return IRREGULAR[word];
  if (/(s|x|ch|sh)$/.test(word)) return word + "es";
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + "ies";
  return word + "s";
}
export const nOf = (n, word, many) => `${n} ${Number(n) === 1 ? word : (many || plural(word))}`;
export const verb = (n, one, many) => (Number(n) === 1 ? one : many);
