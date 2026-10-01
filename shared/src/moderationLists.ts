// Keyword moderation for chat reactions. Patterns run against the tokenized,
// lowercased message wrapped in spaces, so each word match is whole-word.
// This list is intentionally conservative and is meant to be extended by the
// operator; the server can also plug in an external moderation service
// (see server/src/moderation.ts). Nothing matched here is ever displayed.

const w = (words: string[]) => new RegExp(` (${words.join('|')}) `);

/** Silently filtered: no animation, no onscreen text. */
export const SEVERE_PATTERNS: RegExp[] = [
  // Anything sexual alongside a reference to minors.
  new RegExp(
    ' (loli|lolis|shota|underage|child|children|kid|kids|minor|minors|preteen|schoolgirl|jailbait|cp|toddler|little girl|young girl|teen|teens) ',
  ),
  // Threats and violence toward people.
  w(['kill yourself', 'kys', 'kill you', 'ill kill', 'i will kill', 'murder you', 'rape', 'raped', 'raping', 'rapist', 'shoot you', 'stab you', 'bomb', 'dox', 'doxx', 'swat you']),
  // Slurs and hate (extend as needed).
  w(['nigger', 'niggers', 'nigga', 'faggot', 'faggots', 'fag', 'retard', 'retarded', 'tranny', 'kike', 'spic', 'chink', 'wetback', 'heil hitler', 'gas the']),
];

/** Sexual or boundary-pushing: the character declines with a finger wag. */
export const BOUNDARY_PATTERNS: RegExp[] = [
  w([
    'nude', 'nudes', 'naked', 'nsfw', 'strip', 'stripping', 'take it off', 'boobs', 'boob', 'tits', 'titties',
    'tiddies', 'ass', 'butt', 'booty', 'thicc', 'sexy', 'sex', 'horny', 'fuck me', 'lewd', 'hentai', 'onlyfans', 'feet pics', 'panties', 'bra',
    'bikini now', 'bend over', 'spank', 'kiss me', 'lick', 'suck', 'cum', 'dick', 'cock', 'pussy', 'milkers', 'jiggle', 'bounce them', 'wardrobe malfunction',
    'no clothes', 'clothes off', 'undress',
  ]),
];
