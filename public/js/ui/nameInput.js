// Name fields (join form, customizer): live "n/12" counter + grapheme-safe cut at the server's NAME_MAX.
// `maxlength` counts UTF-16 units (an emoji = 2), so it's set loosely in the markup and enforced here.
import { NAME_MAX, clampName, nameFits, nameLength } from '../format.js';

/** Live "n/12" counter + grapheme-safe cut (maxlength counts UTF-16 units, not what people see). */
export function bindNameInput(input, counter) {
  const update = (ev) => {
    const v = input.value;
    // never cut in the middle of a Korean IME composition (compositionend runs this again)
    if (!ev?.isComposing && nameLength(v) > NAME_MAX) {
      const pos = input.selectionStart;
      input.value = clampName(v);
      if (pos != null) input.setSelectionRange(Math.min(pos, input.value.length), Math.min(pos, input.value.length));
    }
    if (counter) {
      const n = nameLength(input.value.trim());
      counter.textContent = n ? `${n}/${NAME_MAX}` : '';
      counter.classList.toggle('over', !nameFits(input.value.trim()));
    }
  };
  input.addEventListener('input', update);
  input.addEventListener('compositionend', () => update());
  update();
  return update;
}
