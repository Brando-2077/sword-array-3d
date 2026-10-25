
export enum FormationState {
  IDLE = 'IDLE',
  POINT_STRIKE = 'POINT_STRIKE',   // 1 finger
  DUAL_STREAM = 'DUAL_STREAM',     // 2 fingers
  TRIPLE_HELIX = 'TRIPLE_HELIX',   // 3 fingers
  FAN_WAVE = 'FAN_WAVE',           // 4 fingers
  SWARM = 'SWARM',                 // 5 fingers
  SHIELD_DISK = 'SHIELD_DISK',     // Palm (open hand)
  RETRACT = 'RETRACT'              // Fist
}

export enum HandRole {
  RIGHT = 'RIGHT',
  LEFT = 'LEFT'
}

export interface HandData {
  role: HandRole;
  detected: boolean;
  x: number;        // normalized 0-1, palm center X
  y: number;        // normalized 0-1, palm center Y
  distance: number; // estimated distance: 0=far, 1=close (based on hand size)
  fingerCount: number; // 0=fist, 1-5 extended fingers
  isPalm: boolean;  // all 5 fingers extended = open palm
  isFist: boolean;  // 0 fingers = fist
}

export interface InteractionData {
  left: HandData;
  right: HandData;
  // Derived values for the sword system
  targetX: number;      // cursor position from right hand
  targetY: number;
  targetActive: boolean;
  formation: FormationState;
  swordScale: number;   // from left hand distance (5.0 ~ 30.0)
  swordCount: number;   // from left hand finger count (10 ~ 200)
  animSpeed: number;    // from right hand distance (0.2 ~ 3.0, 5 levels)
  locked: boolean;      // left fist = freeze values
}

