export interface Segment<T extends string> {
  value: T;
  label: string;
}

/** An Apple-style segmented control. */
export function Segmented<T extends string>(props: {
  label: string;
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset class="segmented" aria-label={props.label}>
      {props.segments.map((s) => (
        <button
          key={s.value}
          type="button"
          aria-pressed={s.value === props.value}
          onClick={() => props.onChange(s.value)}
        >
          {s.label}
        </button>
      ))}
    </fieldset>
  );
}
