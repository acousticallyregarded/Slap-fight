import type { GameConfig } from './config';
import type { ChatCategory, ChatReaction, CharacterId, RawChatMessage, ReactionTarget } from './types';
import { BOUNDARY_PATTERNS, SEVERE_PATTERNS } from './moderationLists';

/**
 * Chat text is only ever used to pick one entry from this fixed table. It is
 * never evaluated, forwarded to a model, or turned into character dialogue.
 */
export const REACTION_LIBRARY: Record<ChatCategory, { bubbles: string[]; label: string }> = {
  greeting: { bubbles: ['Hi hi!', 'Hey there!'], label: 'waves hello with a peace sign' },
  attention: { bubbles: ['I see you!', 'Hm?'], label: 'looks over and waves' },
  compliment: { bubbles: ['Thanks!', 'Aww, thank you!'], label: 'smiles and blushes' },
  flirt: { bubbles: ['Oh my~', 'Flatterer!'], label: 'strikes a coy pose' },
  boundary: { bubbles: ['Eyes up here!', 'Nice try!'], label: 'wags a finger: no' },
  buyCheer: { bubbles: ['Buy team, let’s go!'], label: 'fist pump' },
  sellCheer: { bubbles: ['Too easy~'], label: 'smug victory sign' },
  laughter: { bubbles: ['Ahaha!', 'Hehe!'], label: 'laughs' },
  sportsmanship: { bubbles: ['GG!', 'Good match!'], label: 'both acknowledge the audience' },
};

/** Lowercases, folds lookalike characters and splits into words. */
export function tokenize(text: string): string[] {
  const folded = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/'/g, '');
  return folded.split(/\s+/).filter(Boolean);
}

/** Collapses stretched words: "hiiii" -> "hi", "lolll" -> "lol", "heyyy" -> "hey". */
function squeeze(w: string): string {
  return w.replace(/(.)\1{2,}/g, '$1$1').replace(/^(h+i+)$/, 'hi').replace(/^(yo+)$/, 'yo').replace(/^(he+y+)$/, 'hey').replace(/^(lo+l+)$/, 'lol');
}

function hasPhrase(words: string[], phrase: string): boolean {
  const p = phrase.split(' ');
  outer: for (let i = 0; i + p.length <= words.length; i++) {
    for (let j = 0; j < p.length; j++) if (words[i + j] !== p[j]) continue outer;
    return true;
  }
  return false;
}

const LAUGH_RE = /^(lol|lmao|lmfao|rofl|(ha){2,}h?|(he){2,}h?|kek|xd)$/;

const PHRASES: Partial<Record<ChatCategory, string[]>> = {
  buyCheer: ['go buy', 'buy team', 'team buy', 'lets go buy', 'go go buy', 'buy buy buy'],
  sellCheer: ['go sell', 'sell team', 'team sell', 'lets go sell', 'go go sell'],
  sportsmanship: ['gg', 'ggs', 'good match', 'good game', 'well played', 'gg wp'],
  flirt: ['waifu', 'youre gorgeous', 'you are gorgeous', 'so gorgeous', 'marry me', 'be my wife', 'my wife', 'wifey'],
  compliment: ['cute', 'so cute', 'pretty', 'beautiful', 'love your outfit', 'nice outfit', 'love the outfit', 'lovely', 'queen', 'stunning'],
  attention: ['look here', 'notice me', 'look at me', 'over here', 'senpai notice me'],
  greeting: ['hi', 'hello', 'hey', 'gm', 'good morning', 'hiya', 'yo', 'howdy', 'sup'],
};

/** Words that may follow a standalone "high" greeting ("high sell", "high everyone"). */
const GREETING_ADDRESSEES = new Set(['buy', 'sell', 'girls', 'ladies', 'everyone', 'all', 'yall', 'there', 'chat', 'both', 'you', 'guys']);

export type Classification =
  | { kind: 'severe' }
  | { kind: 'none' }
  | { kind: 'reaction'; category: ChatCategory; named: CharacterId | null };

export function classify(text: string): Classification {
  const raw = (text ?? '').slice(0, 500);
  const words = tokenize(raw).map(squeeze);
  const joined = ' ' + words.join(' ') + ' ';
  if (SEVERE_PATTERNS.some((re) => re.test(joined))) return { kind: 'severe' };
  const named = nameIn(words);
  // Boundary handling outranks every friendly category.
  if (BOUNDARY_PATTERNS.some((re) => re.test(joined))) return { kind: 'reaction', category: 'boundary', named };
  if (words.length === 0) return { kind: 'none' };

  const order: ChatCategory[] = ['buyCheer', 'sellCheer', 'sportsmanship', 'flirt', 'compliment', 'attention'];
  for (const c of order) if (PHRASES[c]!.some((p) => hasPhrase(words, p))) return { kind: 'reaction', category: c, named };
  if (words.some((w) => LAUGH_RE.test(w))) return { kind: 'reaction', category: 'laughter', named };
  if (PHRASES.greeting!.some((p) => hasPhrase(words, p))) return { kind: 'reaction', category: 'greeting', named };
  // "high" counts only as a standalone greeting, optionally addressed.
  if (words[0] === 'high' && words.slice(1).every((w) => GREETING_ADDRESSEES.has(w)) && words.length <= 3) {
    return { kind: 'reaction', category: 'greeting', named };
  }
  return { kind: 'none' };
}

function nameIn(words: string[]): CharacterId | null {
  const b = words.includes('buy');
  const s = words.includes('sell');
  if (b && !s) return 'buy';
  if (s && !b) return 'sell';
  return null;
}

/** Visible snippet: plain text, trimmed, never rendered as HTML by the client. */
export function sanitizeSnippet(text: string, max = 60): string {
  const t = text.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export function senderLabel(sender: string): string {
  const s = sanitizeSnippet(sender, 40);
  return s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s || 'anon';
}

export type ChatOutcome =
  | { result: 'reaction'; reaction: ChatReaction }
  | { result: 'duplicate' | 'filtered' | 'no-match' | 'cooldown' | 'stale' | 'invalid' };

/**
 * Deduplicates, classifies, applies cooldowns and picks a target. Emits at
 * most one reaction per message. Reactions never touch trades or outfits.
 */
export class ChatPipeline {
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private charReadyAt: Record<CharacterId, number> = { buy: 0, sell: 0 };
  private senderReadyAt = new Map<string, number>();
  private alternate: CharacterId = 'buy';
  private counter = 0;

  /** Called for every team cheer that passes moderation, before reaction cooldowns (the crowd bar counts them all). */
  onCheer: ((side: CharacterId, sender: string) => void) | null = null;

  constructor(private config: () => GameConfig) {}

  process(msg: RawChatMessage, now = Date.now()): ChatOutcome {
    if (!msg || typeof msg.messageId !== 'string' || !msg.messageId || typeof msg.text !== 'string') return { result: 'invalid' };
    if (this.seen.has(msg.messageId)) return { result: 'duplicate' };
    this.remember(msg.messageId);
    const cfg = this.config().chat;
    if (now - msg.timestamp > cfg.maxReactionAgeMs) return { result: 'stale' };

    const c = classify(msg.text);
    if (c.kind === 'severe') return { result: 'filtered' };
    if (c.kind === 'none') return { result: 'no-match' };

    const sender = String(msg.sender ?? 'anon');
    if (c.category === 'buyCheer' || c.category === 'sellCheer') this.onCheer?.(c.category === 'buyCheer' ? 'buy' : 'sell', sender);
    if ((this.senderReadyAt.get(sender) ?? 0) > now) return { result: 'cooldown' };

    let target: ReactionTarget;
    if (c.category === 'buyCheer') target = 'buy';
    else if (c.category === 'sellCheer') target = 'sell';
    else if (c.category === 'sportsmanship') target = 'both';
    else if (c.named) target = c.named;
    else {
      // Alternate, skipping a character that is cooling down.
      const first = this.alternate;
      const second: CharacterId = first === 'buy' ? 'sell' : 'buy';
      target = this.charReadyAt[first] <= now ? first : second;
    }
    const chars: CharacterId[] = target === 'both' ? ['buy', 'sell'] : [target];
    if (chars.some((ch) => this.charReadyAt[ch] > now)) return { result: 'cooldown' };

    for (const ch of chars) this.charReadyAt[ch] = now + cfg.perCharacterCooldownMs;
    this.senderReadyAt.set(sender, now + cfg.perSenderCooldownMs);
    if (target !== 'both') this.alternate = target === 'buy' ? 'sell' : 'buy';
    if (this.senderReadyAt.size > 5000) this.pruneSenders(now);

    const lib = REACTION_LIBRARY[c.category];
    const bubble = cfg.showBubbles ? lib.bubbles[this.counter % lib.bubbles.length] : null;
    this.counter++;
    return {
      result: 'reaction',
      reaction: {
        id: `r-${msg.messageId}`,
        messageId: msg.messageId,
        category: c.category,
        target,
        bubble,
        // Boundary-pushing text is never shown.
        displayText: c.category === 'boundary' ? null : sanitizeSnippet(msg.text),
        senderLabel: senderLabel(sender),
        createdAt: msg.timestamp,
        source: msg.source,
      },
    };
  }

  private remember(id: string) {
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > 20_000) this.seen.delete(this.seenOrder.shift()!);
  }

  private pruneSenders(now: number) {
    for (const [k, v] of this.senderReadyAt) if (v <= now) this.senderReadyAt.delete(k);
  }
}
