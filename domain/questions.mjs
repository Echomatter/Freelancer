// Native question answers remain a string[][], including one row per question.
export function questionAnswers(questions, selected, custom) {
  return questions.map((q, i) => {
    const text = q.custom !== false ? (custom[i] ?? "").trim() : "";
    const choices = [...new Set(selected[i] ?? [])];
    return q.multiple
      ? [...new Set([...choices, ...(text ? [text] : [])])]
      : text ? [text] : choices.slice(0, 1);
  });
}

export function pendingQuestions(requests, completed) {
  const seen = new Set();
  return requests.filter((r) => {
    if (!r?.id || completed.has(r.id) || seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
}
