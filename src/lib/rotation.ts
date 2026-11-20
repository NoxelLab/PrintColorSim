/** 紙の向き（度）。yaw は縦軸、pitch は横軸まわりの回転 */
export interface Pose { yaw: number; pitch: number }
export interface Motion { pose: Pose; velocity: Pose }

export const LIMIT: Pose = { yaw: 70, pitch: 60 };
/** 立体に切り替えた時の向き。照明はこの向きを基準に、映り込みが紙のすぐ外に来る位置に置く */
export const REST: Pose = { yaw: -12, pitch: -12 };

/** 慣性の減り方（1/秒）と、止まったとみなす速さ（度/秒） */
const FRICTION = 6;
const STOP = 2;

const bound = (v: number, limit: number) => Math.max(-limit, Math.min(limit, v));
export const clamp = (p: Pose): Pose => ({ yaw: bound(p.yaw, LIMIT.yaw), pitch: bound(p.pitch, LIMIT.pitch) });

/** 指を離した後の慣性で dt 秒進める。端に当たった向きと、遅くなった動きは止める */
export function coast({ pose, velocity }: Motion, dt: number): Motion {
  const k = Math.exp(-FRICTION * dt);
  let yaw = velocity.yaw * k, pitch = velocity.pitch * k;
  const free = { yaw: pose.yaw + yaw * dt, pitch: pose.pitch + pitch * dt };
  const next = clamp(free);
  if (next.yaw !== free.yaw) yaw = 0;
  if (next.pitch !== free.pitch) pitch = 0;
  if (Math.hypot(yaw, pitch) < STOP) yaw = pitch = 0;
  return { pose: next, velocity: { yaw, pitch } };
}

export const moving = ({ velocity }: Motion) => velocity.yaw !== 0 || velocity.pitch !== 0;

export const ease = (t: number) => 1 - (1 - t) ** 3;
export const blend = (a: Pose, b: Pose, t: number): Pose => ({ yaw: a.yaw + (b.yaw - a.yaw) * t, pitch: a.pitch + (b.pitch - a.pitch) * t });
