const zlib = require('zlib');

const packed = 'H4sIAAAAAAAAE7VUwW6cMBD9l-nVRbCwy4ZbmlWVSm0VNZseWuUwNQO4ARvZZjdptP9eGVg2iQCpTXvCxn4z7808zyPsIAkYSJWSgeT7I4gUEgiBwR09QAIXWJFGYHAPydJn8ABJ6L41aqwMJI9QCa2VhgSUhAMD1di6sedlXWAbudt_g8Q_rt-VJF0SoxrN6a3akYYD6zNHQ-ZLlOlHlGmF-o50x2ARR14Yn7U0gjjwwnXwlIop1P7yZgOJ1Q0xUDVyYd3V1_NaDrw-SEsauRVKfkJjj9RiP_JWftBSWwdeFDmaJ2rYWHVNqHkBSYalIXdojC20avLiC-43aHE4qpQLv9Uiz0kPf02llC0g8b01AyrRWMHdbsla5eeSF-p4-_WKV4Pi90JieaHKEnPqxAbRuBdOFWeQCQsJ8D7oa9nEA5sbKXakDZZXqK3gJZlw83XR8_L9My9Y9_7wvTh6bg-syXFqjFUVMKgwF3yrkd8NNeaqbM38JiPKQvcO1I-fxO01x5JcsWMGRvw6LnHQY2pNmEISeSu3IUpbaZkWrVX6PnHVSAtJuAgCBrnGXVstnwEvUJl2ZQpRVa7rvhcuGaC1zm1tDqpcTf-Bm9en3iKnl68sXPjeIuyquPJXnh-H__mV3TLYC91PoEyrqp9BbvkZK9e0nUhJAQOr-ilh1bMTp61HRjPI5SxyOYOMZ5HxDHL1J2yFTOn-SglpRylnqizVfos6JzvD_Nm1MQGt9bs001FsP4DGArRefAKda9d6tgDrv27XC2SGnK40GZKcRgMc9UxXPxPGbqi2xSj-aPXpih1vjFWsmxXTWCEtSTOFbofONHFVk7wolRkXfgo9HaFAmZqtyskWpM9r1OMGNO0gnFbRnY8peDpID7eH34sP0Wl7CAAA';

function decode(b64url) {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const buffer = Buffer.from(b64, 'base64');
    try {
        const decompressed = zlib.gunzipSync(buffer);
        return decompressed.toString();
    } catch (e) {
        // Fallback for plain base64
        return buffer.toString();
    }
}

console.log(JSON.stringify(JSON.parse(decode(packed)), null, 2));
