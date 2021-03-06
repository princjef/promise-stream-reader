import { Writable } from 'stream';

export interface PromiseStream extends Writable {

    /**
     * The current read position in the buffer. This number will only increment
     * upon the completion of the data requested by `read()` or `skip()`.
     */
    offset: number;

    /**
     * Read the specified number of bytes from the stream. Returns a promise
     * that resolves with a Buffer containing the requested data once available
     * or throws an error if the stream is closed or ends before all of the data
     * could be retrieved.
     *
     * @param size The number of bytes to read
     */
    read(size: number): Promise<Buffer>;

    /**
     * Skip the specified number of bytes in the stream. Returns a promise
     * that resolves once the requested number of bytes have been read and
     * skipped or throws an error if the stream is closed or ends before all of
     * the data could be skipped.
     *
     * @param size The number of bytes to skip
     */
    skip(size: number): Promise<void>;
}

interface Waiter {
    size: number;
    skip: boolean;
    resolve: (data?: Buffer) => void;
    reject: (err: any) => void;
}

class PromiseStreamImpl extends Writable implements PromiseStream {
    offset: number = 0;

    private _waiters: Waiter[] = [];
    private _buffer?: { buf?: Buffer; offset: number; size: number };
    private _processTrigger?: () => void;
    private _closed: boolean = false;

    _write(chunk: Buffer, encoding: string, callback: (err?: any) => void) {
        let readPos = 0;
        const process = () => {
            while (this._waiters.length > 0) {
                const waiter = this._waiters[0];
                if (this._buffer) {
                    const bufAvailable = this._buffer.size - this._buffer.offset;
                    if (bufAvailable + chunk.length >= waiter.size) {
                        // If the waiter doesn't actually want the data, just
                        // drop it.
                        if (waiter.skip) {
                            this._buffer = undefined;
                            waiter.resolve();
                        } else {
                            // If we get here the buffer must be defined because
                            // we only drop the data if we were waiting
                            const bufToCopy = Math.min(bufAvailable, waiter.size);
                            const buf = Buffer.alloc(waiter.size);
                            this._buffer.buf!.copy(
                                buf,
                                0,
                                this._buffer.offset,
                                this._buffer.offset + bufToCopy
                            );

                            chunk.copy(
                                buf,
                                bufToCopy,
                                0,
                                waiter.size - bufToCopy
                            );

                            waiter.resolve(buf);
                        }

                        this.offset += waiter.size;
                        this._waiters.shift();
                        this._buffer = undefined;

                        if (bufAvailable + chunk.length === waiter.size) {
                            // There's no more data left. Finish processing.
                            callback();
                            break;
                        } else {
                            readPos += waiter.size - bufAvailable;
                        }
                    } else {
                        // There's not enough data to fill the waiter. Add it to
                        // the buffer and wait.
                        if (!waiter.skip) {
                            const buf = Buffer.alloc(bufAvailable + chunk.length);
                            this._buffer.buf!.copy(
                                buf,
                                0,
                                this._buffer.offset,
                                this._buffer.size
                            );
                            chunk.copy(
                                buf,
                                bufAvailable,
                                0,
                                chunk.length
                            );
                            this._buffer.buf = buf;
                        }

                        this._buffer.offset = 0;
                        this._buffer.size = bufAvailable + chunk.length;

                        // We can't do anything else with our data. Call the
                        // callback and break
                        callback();
                        break;
                    }
                } else {
                    if (chunk.length - readPos >= waiter.size) {
                        if (waiter.skip) {
                            waiter.resolve();
                        } else {
                            waiter.resolve(chunk.slice(
                                readPos,
                                readPos + waiter.size
                            ));
                        }

                        this.offset += waiter.size;
                        this._waiters.shift();
                        readPos += waiter.size;

                        if (chunk.length === readPos) {
                            // There's no more data left. Finish processing.
                            callback();
                            break;
                        }
                    } else {
                        // There's not enough data to fill the waiter. Add it to
                        // the buffer and wait.
                        this._buffer = {
                            buf: waiter.skip ? undefined : chunk.slice(readPos),
                            offset: 0,
                            size: chunk.length - readPos
                        };
                        readPos = chunk.length;
                        callback();
                        break;
                    }
                }
            }

            // If we made it down here and there's still data left in the chunk,
            // we need to wait for more requests to come in. Pass our processing
            // function out to the rest of the object so we can get triggered
            // when there's more work to do. Otherwise, we should clear out the
            this._processTrigger = chunk.length - readPos > 0
                ? process
                : undefined;
        };

        // Run the processing function
        process();
    }

    _destroy(err, callback) {
        this._processTrigger = undefined;
        for (const waiter of this._waiters) {
            waiter.reject(err || new Error('stream destroyed'));
        }
        this._waiters = [];
        this._closed = true;
    }

    _final(callback) {
        this._processTrigger = undefined;
        for (const waiter of this._waiters) {
            waiter.reject(new Error('not enough data in stream'));
        }

        this._waiters = [];
        this._closed = true;
    }

    read(size: number): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            if (this._closed) {
                reject(new Error('stream is closed'));
            }

            this._waiters.push({ resolve, reject, size, skip: false });
            // Flush any waiting data
            if (this._processTrigger) {
                this._processTrigger();
            }
        });
    }

    skip(size: number): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this._closed) {
                reject(new Error('stream is closed'));
            }

            this._waiters.push({ resolve, reject, size, skip: true } as Waiter);
            // Flush any waiting data
            if (this._processTrigger) {
                this._processTrigger();
            }
        });
    }
}

function create(): PromiseStream {
    return new PromiseStreamImpl();
}

// Use the first line for the actual export and the second to get the typings
// right for typescript. This allows both the standard require and typescript
// syntaxes simultaneously.
module.exports = Object.assign(create, { default: create });
export default create;
