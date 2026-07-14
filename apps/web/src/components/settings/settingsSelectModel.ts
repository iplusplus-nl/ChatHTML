export type NavigableSettingsOption = {
  value: string;
  disabled?: boolean;
};

function enabledIndexes(options: readonly NavigableSettingsOption[]): number[] {
  return options.flatMap((option, index) => (option.disabled ? [] : [index]));
}

export function getInitialSettingsOptionIndex(
  options: readonly NavigableSettingsOption[],
  value: string,
  intent: "selected" | "first" | "last" = "selected"
): number {
  const enabled = enabledIndexes(options);
  if (!enabled.length) {
    return -1;
  }
  if (intent === "first") {
    return enabled[0];
  }
  if (intent === "last") {
    return enabled[enabled.length - 1];
  }

  const selectedIndex = options.findIndex(
    (option) => option.value === value && !option.disabled
  );
  return selectedIndex >= 0 ? selectedIndex : enabled[0];
}

export function getAdjacentSettingsOptionIndex(
  options: readonly NavigableSettingsOption[],
  currentIndex: number,
  direction: 1 | -1
): number {
  const enabled = enabledIndexes(options);
  if (!enabled.length) {
    return -1;
  }
  const enabledPosition = enabled.indexOf(currentIndex);
  if (enabledPosition < 0) {
    return direction === 1 ? enabled[0] : enabled[enabled.length - 1];
  }
  return enabled[
    (enabledPosition + direction + enabled.length) % enabled.length
  ];
}
