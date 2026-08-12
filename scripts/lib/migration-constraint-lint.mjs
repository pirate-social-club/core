function maskSqlLiteralsAndComments(sql) {
  let result = "";
  let state = "code";
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];
    if (state === "code" && char === "-" && next === "-") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (state === "code" && char === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else if (state === "code" && char === "'") {
      result += " ";
      state = "string";
    } else if (state === "line-comment") {
      result += char === "\n" ? "\n" : " ";
      if (char === "\n") state = "code";
    } else if (state === "block-comment") {
      if (char === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else {
        result += char === "\n" ? "\n" : " ";
      }
    } else if (state === "string") {
      if (char === "'" && next === "'") {
        result += "  ";
        index += 1;
      } else {
        result += char === "\n" ? "\n" : " ";
        if (char === "'") state = "code";
      }
    } else {
      result += char;
    }
  }
  return result;
}

function lineAt(sql, index) {
  return sql.slice(0, index).split("\n").length;
}

function matchingParen(sql, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < sql.length; index += 1) {
    if (sql[index] === "(") depth += 1;
    if (sql[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function topLevelSegments(sql, start, end) {
  const segments = [];
  let depth = 0;
  let segmentStart = start;
  for (let index = start; index < end; index += 1) {
    if (sql[index] === "(") depth += 1;
    if (sql[index] === ")") depth -= 1;
    if (sql[index] === "," && depth === 0) {
      segments.push({ start: segmentStart, text: sql.slice(segmentStart, index) });
      segmentStart = index + 1;
    }
  }
  segments.push({ start: segmentStart, text: sql.slice(segmentStart, end) });
  return segments;
}

export function findAnonymousTableChecks(sql) {
  const masked = maskSqlLiteralsAndComments(sql);
  const failures = [];
  const createPattern = /\bCREATE\s+TABLE\b/giu;
  for (const match of masked.matchAll(createPattern)) {
    const openIndex = masked.indexOf("(", match.index + match[0].length);
    if (openIndex < 0) continue;
    const closeIndex = matchingParen(masked, openIndex);
    if (closeIndex < 0) continue;
    for (const segment of topLevelSegments(masked, openIndex + 1, closeIndex)) {
      const leading = segment.text.match(/^\s*/u)?.[0].length ?? 0;
      if (/^CHECK\s*\(/iu.test(segment.text.slice(leading))) {
        failures.push({ line: lineAt(masked, segment.start + leading), kind: "create_table" });
      }
    }
    createPattern.lastIndex = closeIndex + 1;
  }

  const alterPattern = /\bALTER\s+TABLE\b[\s\S]*?\bADD\s+CHECK\s*\(/giu;
  for (const match of masked.matchAll(alterPattern)) {
    const checkOffset = match[0].search(/\bCHECK\s*\(/iu);
    failures.push({ line: lineAt(masked, match.index + checkOffset), kind: "alter_table" });
  }
  return failures;
}

function normalizedTableName(value) {
  return value.replaceAll('"', "").split(".").at(-1).toLowerCase();
}

function hasSafetyReviewAnnotation(sql, beforeIndex) {
  const precedingLines = sql.slice(0, beforeIndex).split("\n").slice(-4).join("\n");
  return /--\s*migration-safety:\s*existing-table-check-reviewed\s*:\s*\S/iu.test(precedingLines);
}

function newNullableColumnAllowsExistingRows(masked, table, beforeIndex, checkBody) {
  const addColumnPattern = /\bALTER\s+TABLE\s+(?:ONLY\s+)?([\w."]+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w"]+)([^;]*);/giu;
  for (const match of masked.slice(0, beforeIndex).matchAll(addColumnPattern)) {
    if (normalizedTableName(match[1]) !== table || /\bNOT\s+NULL\b/iu.test(match[3])) continue;
    const column = match[2].replaceAll('"', "");
    const nullableAlternative = new RegExp(`\\b${column}\\s+IS\\s+NULL\\s+OR\\b`, "iu");
    if (nullableAlternative.test(checkBody)) return true;
  }
  return false;
}

// Existing rows are checked as soon as PostgreSQL adds a CHECK constraint. New
// tables have no pre-existing rows, but a constraint added to an old table
// needs an explicit proof that its current rows are safe: a migration-side
// UPDATE/DELETE, or a short reviewer-owned annotation when data is known to be
// safe without a rewrite.
export function findExistingTableCheckSafetyGaps(sql) {
  const masked = maskSqlLiteralsAndComments(sql);
  const createdTables = new Set();
  for (const match of masked.matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)/giu)) {
    createdTables.add(normalizedTableName(match[1]));
  }

  const mutations = [];
  for (const match of masked.matchAll(/\b(?:UPDATE|DELETE\s+FROM)\s+([\w."]+)/giu)) {
    mutations.push({ index: match.index, table: normalizedTableName(match[1]) });
  }

  const failures = [];
  const addCheckPattern = /\bALTER\s+TABLE\s+(?:ONLY\s+)?([\w."]+)\s+[^;]*?\bADD\s+CONSTRAINT\s+([\w"]+)\s+CHECK\s*\(/giu;
  for (const match of masked.matchAll(addCheckPattern)) {
    const table = normalizedTableName(match[1]);
    if (createdTables.has(table)) continue;
    const hasPriorMutation = mutations.some((mutation) => mutation.table === table && mutation.index < match.index);
    const openIndex = match.index + match[0].lastIndexOf("(");
    const closeIndex = matchingParen(masked, openIndex);
    const checkBody = closeIndex < 0 ? "" : masked.slice(openIndex + 1, closeIndex);
    if (
      hasPriorMutation
      || newNullableColumnAllowsExistingRows(masked, table, match.index, checkBody)
      || hasSafetyReviewAnnotation(sql, match.index)
    ) continue;
    failures.push({
      line: lineAt(masked, match.index),
      table,
      constraint: match[2].replaceAll('"', ""),
    });
  }
  return failures;
}
