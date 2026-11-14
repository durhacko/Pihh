export interface ViewMode { xray: boolean; beliefColours: boolean; selectedDroneId: number | null }
let mode: ViewMode = { xray: false, beliefColours: false, selectedDroneId: null };

/** Display settings only: this module never receives a world or brain. */
export function readViewMode(): Readonly<ViewMode> { return { ...mode }; }
export function setViewMode(patch: Partial<ViewMode>): Readonly<ViewMode> { mode = { ...mode, ...patch }; return readViewMode(); }
export function resetViewMode(): void { mode = { xray: false, beliefColours: false, selectedDroneId: null }; }
