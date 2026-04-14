/** Shared tracking primitives for observable material properties. */

export function observableColor3(r: number, g: number, b: number, owner: { _uboDirty?: boolean }): [number, number, number] {
    const arr = [r, g, b] as [number, number, number];
    for (let i = 0; i < 3; i++) {
        let val = arr[i]!;
        Object.defineProperty(arr, i, {
            get() {
                return val;
            },
            set(v: number) {
                if (val !== v) {
                    val = v;
                    owner._uboDirty = true;
                }
            },
            configurable: true,
            enumerable: true,
        });
    }
    return arr;
}

export function observableVec2(x: number, y: number, owner: { _uboDirty?: boolean }): [number, number] {
    const arr = [x, y] as [number, number];
    for (let i = 0; i < 2; i++) {
        let val = arr[i]!;
        Object.defineProperty(arr, i, {
            get() {
                return val;
            },
            set(v: number) {
                if (val !== v) {
                    val = v;
                    owner._uboDirty = true;
                }
            },
            configurable: true,
            enumerable: true,
        });
    }
    return arr;
}

export function trackScalar(obj: any, key: string): void {
    let val = obj[key];
    Object.defineProperty(obj, key, {
        get() {
            return val;
        },
        set(v: any) {
            if (val !== v) {
                val = v;
                obj._uboDirty = true;
            }
        },
        configurable: true,
        enumerable: true,
    });
}

export function trackSubProps(parent: { _uboDirty?: boolean }, sub: any, keys: string[]): void {
    for (const key of keys) {
        let val = sub[key];
        Object.defineProperty(sub, key, {
            get() {
                return val;
            },
            set(v: any) {
                if (val !== v) {
                    val = v;
                    parent._uboDirty = true;
                }
            },
            configurable: true,
            enumerable: true,
        });
    }
}
