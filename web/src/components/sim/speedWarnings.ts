/**
 * The deployment-speed thresholds, in the order both editors show them: the
 * single-deployment threshold, then the main's high and low pair, then the
 * drogue's low. Each is a speed stored in SI and edited in the velocity unit.
 * Keys stay literal so the i18n key scan can find them.
 */
export const SPEED_WARNINGS = [
  { key: 'deploymentSpeedWarn', label: 'settings.deploySpeedWarn', hint: 'settings.deploySpeedWarnHint' },
  { key: 'mainHighSpeedWarn', label: 'settings.mainHighSpeedWarn', hint: 'settings.mainHighSpeedWarnHint' },
  { key: 'mainLowSpeedWarn', label: 'settings.mainLowSpeedWarn', hint: 'settings.mainLowSpeedWarnHint' },
  { key: 'drogueLowSpeedWarn', label: 'settings.drogueLowSpeedWarn', hint: 'settings.drogueLowSpeedWarnHint' },
] as const;
