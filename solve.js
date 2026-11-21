// Fast drop-in for csv-reader 1.0.0: run(input) returns exactly csv-reader's
// {columns, rows, errors} for {text, header}, but without the reference's
// one-character-at-a-time loop. One left-to-right pass over the text; plain
// fields are taken as slices between delimiters found with indexOf (which
// runs in native code), quoted fields are taken as slices between quotes,
// and string building only happens on the rare paths that need it (a doubled
// quote, a line break inside quotes, a stray CR). No regex, no per-field
// concatenation in the common case, nothing kept from one call to the next.
// The field readers return the field string itself and report how it ended
// through shared locals, so no result object is allocated per field.
//
// The broken-row policy is csv-reader's own, reproduced exactly:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not doubled
//     ("" inside it is one quote, each CRLF or lone CR inside it is LF);
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that
//     never closes is a literal character and the text after it is read again
//     as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows are the
//     records after it, each padded with "" (short_row, with fields: its field
//     count) or cut (long_row, with extra: the cut fields) to the first
//     record's width;
//   - each error is {code, line, row} in the order met; line is the 1-based
//     line its record starts on, counting every LF, CRLF and lone CR inside
//     quotes, and row is its record's index in rows (null for the header).

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  // The next character to read, and the line it is on (1-based).
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  // The record being read: the line it starts on, its index in rows (null: header).
  let recordLine = 1;
  let recordRow = null;
  // How the last field read ended (COMMA, LINE_BREAK or END), and how many
  // characters were kept after the value a field was read onto.
  let ended = END;
  let added = 0;

  // A quoted segment [a, b) with its line breaks normalised to LF. The fast
  // path is a plain slice; the slow path only runs when the segment holds a
  // CR or LF, and counts each line break it turns into an LF.
  function normalise(a, b) {
    const nl = text.indexOf('\n', a);
    const cr = text.indexOf('\r', a);
    if ((nl === -1 || nl >= b) && (cr === -1 || cr >= b)) return text.slice(a, b);
    const parts = [];
    let i = a;
    while (i < b) {
      const c = text.charCodeAt(i);
      if (c === 13) {
        parts.push('\n');
        line += 1;
        i += text.charCodeAt(i + 1) === 10 ? 2 : 1;
      } else if (c === 10) {
        parts.push('\n');
        line += 1;
        i += 1;
      } else {
        let j1 = text.indexOf('\r', i);
        let j2 = text.indexOf('\n', i);
        let j = b;
        if (j1 !== -1 && j1 < b) j = j1;
        if (j2 !== -1 && j2 < b && j2 < j) j = j2;
        parts.push(text.slice(i, j));
        i = j;
      }
    }
    return parts.join('');
  }

  // Reads an unquoted field starting at pos, onto `init` ('' normally, '"'
  // when an unterminated quote is re-read as unquoted). Sets `ended` and
  // `added` and returns the field string.
  function readUnquoted(init) {
    let cur = pos;
    // Fast path: the first delimiter decides the field, unless a lone CR
    // comes first. A lone CR is rare, so only it takes the slow path below.
    let iC = text.indexOf(',', cur);
    let iL = text.indexOf('\n', cur);
    let iR = text.indexOf('\r', cur);
    let m = -1;
    let k = 0;
    if (iC !== -1) { m = iC; k = COMMA; }
    if (iL !== -1 && (m === -1 || iL < m)) { m = iL; k = LINE_BREAK; }
    if (iR !== -1 && (m === -1 || iR < m)) { m = iR; k = 2; }
    if (k !== 2 || m === -1 || text.charCodeAt(m + 1) === 10) {
      const end = m === -1 ? n : m;
      const value = init === '' ? text.slice(cur, end) : init + text.slice(cur, end);
      added = end - cur;
      if (m === -1) {
        pos = n;
        ended = END;
        return value;
      }
      if (k === COMMA) {
        pos = m + 1;
        ended = COMMA;
        return value;
      }
      if (k === LINE_BREAK) {
        pos = m + 1;
        line += 1;
        ended = LINE_BREAK;
        return value;
      }
      // A CR followed by LF: the record ends at the pair.
      pos = m + 2;
      line += 1;
      ended = LINE_BREAK;
      return value;
    }
    // Slow path: one or more lone CRs before the next delimiter. Each is
    // dropped with a stray_cr error; the kept pieces are joined at the end.
    const parts = [];
    if (init !== '') parts.push(init);
    added = 0;
    for (;;) {
      iC = text.indexOf(',', cur);
      iL = text.indexOf('\n', cur);
      iR = text.indexOf('\r', cur);
      m = -1;
      k = 0;
      if (iC !== -1) { m = iC; k = COMMA; }
      if (iL !== -1 && (m === -1 || iL < m)) { m = iL; k = LINE_BREAK; }
      if (iR !== -1 && (m === -1 || iR < m)) { m = iR; k = 2; }
      if (m === -1) {
        parts.push(text.slice(cur, n));
        added += n - cur;
        pos = n;
        ended = END;
        return parts.join('');
      }
      if (k === COMMA) {
        parts.push(text.slice(cur, m));
        added += m - cur;
        pos = m + 1;
        ended = COMMA;
        return parts.join('');
      }
      if (k === LINE_BREAK) {
        parts.push(text.slice(cur, m));
        added += m - cur;
        pos = m + 1;
        line += 1;
        ended = LINE_BREAK;
        return parts.join('');
      }
      if (text.charCodeAt(m + 1) === 10) {
        parts.push(text.slice(cur, m));
        added += m - cur;
        pos = m + 2;
        line += 1;
        ended = LINE_BREAK;
        return parts.join('');
      }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      parts.push(text.slice(cur, m));
      added += m - cur;
      cur = m + 1;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets `ended` and
  // returns the field string.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let cur = pos + 1;
    let parts = null;
    for (;;) {
      const q = text.indexOf('"', cur);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, and the field goes on.
        if (parts === null) parts = [];
        parts.push(normalise(cur, q));
        parts.push('"');
        cur = q + 2;
        continue;
      }
      // The closing quote.
      let value;
      if (parts === null) {
        value = normalise(cur, q);
      } else {
        parts.push(normalise(cur, q));
        value = parts.join('');
      }
      pos = q + 1;
      if (pos >= n) {
        ended = END;
        return value;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        ended = COMMA;
        return value;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        ended = LINE_BREAK;
        return value;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        ended = LINE_BREAK;
        return value;
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      const junk = readUnquoted(value);
      if (added > 0) {
        errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      }
      return junk;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted(''));
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
