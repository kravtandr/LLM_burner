import { useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export function HistoryInput({ label, value, onChange, onRemember, suggestions, dropdownLabel, ...inputProps }) {
  const id = useId(), input = useRef(null);
  const [open, setOpen] = useState(false), [all, setAll] = useState(false), [active, setActive] = useState(-1);
  const choices = all ? suggestions : suggestions.filter(item => item.toLowerCase().includes(value.trim().toLowerCase()));
  function choose(item) { onChange(item); onRemember(item, true); setOpen(false); setActive(-1); input.current?.focus(); }
  function keys(event) {
    if (event.key === 'Escape') { setOpen(false); setActive(-1); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setOpen(true);
      const next = choices.length ? (event.key === 'ArrowDown' ? (!open ? 0 : (active + 1) % choices.length) : (!open || active <= 0 ? choices.length - 1 : active - 1)) : -1;
      setActive(next);
      requestAnimationFrame(() => document.getElementById(`${id}-option-${next}`)?.scrollIntoView({ block: 'nearest' }));
    } else if (event.key === 'Enter' && open && active >= 0 && choices[active]) { event.preventDefault(); choose(choices[active]); }
  }
  return <div className="field history-field" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); onRemember(value, true); }
  }}>
    <label className="field-label" htmlFor={id}>{label}</label>
    <div className="history-input-wrap">
      <input {...inputProps} id={id} ref={input} value={value} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && active >= 0 && choices[active] ? `${id}-option-${active}` : undefined}
        onKeyDown={keys} onChange={event => { onChange(event.target.value); onRemember(event.target.value, false); setAll(false); setActive(-1); setOpen(true); }} />
      <button className="history-input-toggle" type="button" aria-label={dropdownLabel} aria-expanded={open} aria-controls={`${id}-list`} onClick={() => { input.current?.focus(); setAll(true); setActive(-1); setOpen(!(open && all)); }}><ChevronDown size={14} /></button>
      {open && <div className="history-options" id={`${id}-list`} role="listbox" aria-label={`${label} suggestions`}>
        {choices.length ? choices.map((item, index) => <div key={item} id={`${id}-option-${index}`} role="option" aria-selected={index === active} className={index === active ? 'active' : ''} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(item)}>{item}</div>) : <div className="history-options-empty" role="presentation">{suggestions.length ? 'No matching entries. Keep typing to use a new value.' : 'No saved entries yet. Type a value to remember it.'}</div>}
      </div>}
    </div>
  </div>;
}
