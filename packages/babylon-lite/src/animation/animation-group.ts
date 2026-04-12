// AnimationGroup — user-facing handle for a single animation clip.
// Stored on scene.animationGroups[]. Provides play/pause/stop + frame access.

import type { GltfAnimationData } from "./types.js";
import { createAnimationController } from "../skeleton/skeleton-updater.js";
import type { AnimationController } from "../skeleton/skeleton-updater.js";

/** User-facing animation group — one per glTF animation clip. */
export interface AnimationGroup {
    /** Name of this animation (from glTF). */
    readonly name: string;
    /** Duration in seconds. */
    readonly duration: number;
    /** True if currently playing. */
    readonly isPlaying: boolean;
    /** Current playback time in seconds. */
    currentFrame: number;
    /** Playback speed multiplier (default 1). */
    speedRatio: number;
    /** Whether animation loops (default true). */
    loopAnimation: boolean;
    /** Start playing. */
    play(): void;
    /** Pause playback. */
    pause(): void;
    /** Stop playback and reset to frame 0. */
    stop(): void;
    /** Seek to a specific frame (at 60 fps, matching BJS convention) and pause. */
    goToFrame(frame: number): void;
    /** Advance animation by deltaMs. Called by the engine each frame. */
    _tick(deltaMs: number, device: GPUDevice): void;
    /** Debug: internal animation controller. */
    readonly _ctrl?: AnimationController;
}

/** Create AnimationGroup(s) from parsed glTF animation data.
 *  Returns one group per animation clip. */
export function createAnimationGroups(animData: GltfAnimationData): AnimationGroup[] {
    if (animData.clips.length === 0 || (animData.skeletons.length === 0 && animData.morphBindings.length === 0)) {
        return [];
    }

    // The skeleton controller handles all clips internally, but currently only
    // evaluates clips[0]. We create one AnimationGroup per clip and share the
    // underlying skeleton update infrastructure.
    return animData.clips.map((clip, clipIndex) => {
        // Create a per-clip animation data slice (same nodes/skeletons, single clip)
        const clipAnimData: GltfAnimationData = {
            clips: [clip],
            nodes: animData.nodes,
            skeletons: animData.skeletons,
            morphBindings: animData.morphBindings,
        };
        const ctrl: AnimationController = createAnimationController(clipAnimData);
        // Auto-play by default (matches Babylon.js behavior)
        ctrl.playing = true;
        let stopped = false;

        const group: AnimationGroup = {
            name: clip.name || `animation_${clipIndex}`,
            duration: clip.duration,

            get isPlaying(): boolean {
                return ctrl.playing;
            },

            get currentFrame(): number {
                return ctrl.time;
            },
            set currentFrame(v: number) {
                ctrl.time = v;
            },

            get speedRatio(): number {
                return ctrl.speedRatio;
            },
            set speedRatio(v: number) {
                ctrl.speedRatio = v;
            },

            get loopAnimation(): boolean {
                return ctrl.loop;
            },
            set loopAnimation(v: boolean) {
                ctrl.loop = v;
            },

            play() {
                ctrl.playing = true;
                stopped = false;
            },
            pause() {
                ctrl.playing = false;
            },
            stop() {
                ctrl.playing = false;
                ctrl.time = 0;
                stopped = true;
            },
            goToFrame(frame: number) {
                ctrl.time = frame / 60;
                ctrl.playing = false;
            },

            _ctrl: ctrl,

            _tick(deltaMs: number, device: GPUDevice) {
                if (stopped) {
                    return;
                }
                ctrl.tick(deltaMs, device);
            },
        };
        return group;
    });
}
