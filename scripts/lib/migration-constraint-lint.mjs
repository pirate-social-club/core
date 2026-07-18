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
