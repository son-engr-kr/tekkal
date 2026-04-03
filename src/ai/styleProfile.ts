import type { Deck } from "@/types/deck";

export interface StyleProfile {
  avgSentenceLength: number;
  tone: "formal" | "casual" | "mixed";
  structure: "paragraphs" | "bullets" | "mixed";
  avgNotesLength: number;
  examples: string[];
}

export function analyzeNotesStyle(deck: Deck): StyleProfile | null {
  const notesSlides = deck.slides.filter((s) => s.notes?.trim());
  if (notesSlides.length < 2) return null;

  const allNotes = notesSlides.map((s) => s.notes!.trim()).filter((n): n is string => n.length > 0);

  // Average notes length
  const avgNotesLength = Math.round(
    allNotes.reduce((sum, n) => sum + n.length, 0) / allNotes.length
  );

  // Sentence analysis
  const sentences = allNotes.flatMap((n) =>
    n.split(/[.!?]+/).filter((s) => s.trim().length > 0)
  );
  const avgSentenceLength = sentences.length
    ? Math.round(
        sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) /
          sentences.length
      )
    : 15;

  // Tone detection
  const formalIndicators = /\b(therefore|furthermore|consequently|regarding|utilizing|implement)\b/gi;
  const casualIndicators = /\b(gonna|wanna|let's|cool|awesome|basically|just|stuff)\b/gi;
  const formalCount = allNotes.join(" ").match(formalIndicators)?.length ?? 0;
  const casualCount = allNotes.join(" ").match(casualIndicators)?.length ?? 0;
  const tone: StyleProfile["tone"] =
    formalCount > casualCount * 2 ? "formal" : casualCount > formalCount * 2 ? "casual" : "mixed";

  // Structure detection
  const bulletCount = allNotes.filter((n) => /^[-*•]\s/m.test(n)).length;
  const structure: StyleProfile["structure"] =
    bulletCount > allNotes.length * 0.6 ? "bullets" : bulletCount < allNotes.length * 0.2 ? "paragraphs" : "mixed";

  // Pick up to 3 representative examples (shortest, median, longest)
  const sorted = [...allNotes].sort((a, b) => a.length - b.length);
  const examples: string[] = [];
  if (sorted.length >= 3) {
    examples.push(sorted[0]!, sorted[Math.floor(sorted.length / 2)]!, sorted[sorted.length - 1]!);
  } else {
    examples.push(...sorted);
  }

  return { avgSentenceLength, tone, structure, avgNotesLength, examples };
}

export function formatStyleContext(profile: StyleProfile): string {
  return `## Speaker Notes Style Profile
- Average sentence length: ${profile.avgSentenceLength} words
- Tone: ${profile.tone}
- Structure: ${profile.structure}
- Average notes length: ${profile.avgNotesLength} characters

### Examples from existing notes:
${profile.examples.map((e, i) => `Example ${i + 1}:\n"${e}"\n`).join("\n")}

Match this style when generating new notes.`;
}
