import * as crypto from 'crypto';
import test from 'ava';

import create from '.';

test('breaks preloaded data up into the requested chunks', async t => {
    const buf = crypto.randomBytes(14);
    const stream = create();

    stream.end(buf);
    t.deepEqual(buf.slice(0, 4), await stream.read(4));
    t.deepEqual(buf.slice(4, 8), await stream.read(4));
    t.deepEqual(buf.slice(8, 14), await stream.read(6));
});

test('throws if more data is requested than is available', async t => {
    const buf = crypto.randomBytes(14);
    const stream = create();

    stream.end(buf);
    t.deepEqual(buf.slice(0, 4), await stream.read(4));
    t.deepEqual(buf.slice(4, 8), await stream.read(4));
    t.deepEqual(buf.slice(8, 14), await stream.read(6));
    try {
        await stream.read(6);
        t.fail('should have thrown');
    } catch (e) {
        t.true(e instanceof Error);
    }
});

test('buffers data until there is enough to satisfy the request', async t => {
    const buf = crypto.randomBytes(12);
    const stream = create();

    const data = stream.read(10);
    stream.write(buf.slice(0, 5));
    stream.write(buf.slice(5, 7));
    stream.end(buf.slice(7));
    t.deepEqual(buf.slice(0, 10), await data);
});

test('satisfies the request as soon as the exact amount of data needed is available', async t => {
    const buf = crypto.randomBytes(12);
    const stream = create();

    stream.write(buf.slice(0, 7));
    const data = stream.read(10);
    stream.end(buf.slice(7, 10));
    t.deepEqual(buf.slice(0, 10), await data);
});

test('allows the data to arrive after it is requested', async t => {
    const buf = crypto.randomBytes(12);
    const stream = create();

    const data = Promise.all([
        stream.read(4),
        stream.read(4),
        stream.read(2)
    ]);

    stream.end(buf);
    t.deepEqual([
        buf.slice(0, 4),
        buf.slice(4, 8),
        buf.slice(8, 10)
    ], await data);
});

test('fails any requests that come in after the stream has ended', async t => {
    const buf = crypto.randomBytes(10);
    const stream = create();

    const data = stream.read(10);
    stream.end(buf);
    t.deepEqual(buf, await data);

    // Let stuff clear
    await new Promise(resolve => setTimeout(resolve));

    try {
        await stream.read(1);
        t.fail('should have thrown');
    } catch (e) {
        try {
            await stream.skip(1);
            t.fail('should have thrown');
        } catch (e) {
            t.true(e instanceof Error);
        }
    }
});

test('fails pending requests if the socket is destroyed while they wait', async t => {
    const stream = create();

    const data = stream.read(10);
    const error = new Error('something happened');
    stream.destroy(error);

    try {
        await data;
        t.fail('should have thrown');
    } catch (e) {
        t.is(e, error);
    }
});

test('passes an error if no error is passed on destroy', async t => {
    const stream = create();

    const data = stream.read(10);
    stream.destroy();

    try {
        await data;
        t.fail('should have thrown');
    } catch (e) {
        t.true(e instanceof Error);
    }
});

test('skips data if requested', async t => {
    const buf = crypto.randomBytes(14);
    const stream = create();

    stream.end(buf);
    t.deepEqual(buf.slice(0, 4), await stream.read(4));
    await stream.skip(4);
    t.deepEqual(buf.slice(8, 14), await stream.read(6));
});

test('skips multiple chunks of data if needed', async t => {
    const buf = crypto.randomBytes(12);
    const stream = create();

    stream.skip(10).catch((e: any) => { t.fail(e); });
    const data = stream.read(2);
    stream.write(buf.slice(0, 5));
    stream.write(buf.slice(5, 7));
    stream.end(buf.slice(7));
    t.deepEqual(buf.slice(10), await data);
});
