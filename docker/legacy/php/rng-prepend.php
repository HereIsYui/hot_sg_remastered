<?php
/**
 * Differential-test scripted RNG (legacy side), loaded as php.ini `auto_prepend_file`.
 *
 * When a request carries the `X-Difftest-Rng` header, this overrides `rand()` / `mt_rand()`
 * (and, when asked, `array_rand()` / `shuffle()`) with the `uopz` extension so they draw from a
 * sequence the test declared, in call order. Both servers draw the SAME sequence and apply the
 * SAME scaling, so a random game outcome is identical on both sides without either reproducing
 * the other's RNG internals. Absent the header this is a no-op and real randomness is used, so
 * ordinary play and the untouched legacy tick are unaffected.
 *
 * Header format (built by tools/src/lib/difftest/side.ts):
 *   X-Difftest-Rng: <int>[,<int>...]        a raw draw sequence, cycled if exhausted
 *   X-Difftest-Rng: seed:<int>              a deterministic PRNG seeded with <int>
 *
 * Scaling for a bounded call rand($min,$max) / mt_rand($min,$max):
 *   $min + (draw mod ($max - $min + 1))      — the same formula RandomService.scripted() uses.
 * A no-argument rand() / mt_rand() returns the raw draw unchanged.
 */

if (!extension_loaded('uopz')) {
    return;
}

// HTTP requests carry the spec in a header (apache); `php -r` tick runs carry it in an env var.
$spec = null;
if (isset($_SERVER['HTTP_X_DIFFTEST_RNG'])) {
    $spec = (string) $_SERVER['HTTP_X_DIFFTEST_RNG'];
} elseif (getenv('HOT_DIFFTEST_RNG') !== false) {
    $spec = (string) getenv('HOT_DIFFTEST_RNG');
}
if ($spec === null || $spec === '') {
    return;
}

if (strncmp($spec, 'seed:', 5) === 0) {
    // A 31-bit LCG so a case can say "give me a reproducible stream" without listing values.
    // The new server (RandomService.seedSource) runs the IDENTICAL recurrence, verified to agree
    // value-for-value; only the final scaled values must match, but the raw streams do too.
    $state = ((int) substr($spec, 5)) & 0x7fffffff;
    $draw = function () use (&$state) {
        $state = (1103515245 * $state + 12345) & 0x7fffffff;
        return $state;
    };
} else {
    $seq = array();
    foreach (explode(',', $spec) as $t) {
        if ($t !== '') {
            $seq[] = (int) $t;
        }
    }
    if (!$seq) {
        return;
    }
    $i = 0;
    $draw = function () use ($seq, &$i) {
        $v = $seq[$i % count($seq)];
        $i++;
        return $v;
    };
}

$scale = function ($min, $max, $v) {
    $min = (int) $min;
    $max = (int) $max;
    if ($max > $min) {
        return $min + ($v % ($max - $min + 1));
    }
    if ($max === $min) {
        return $min;
    }
    // max < min: PHP's own rand() returns false/min here; mirror RandomService (returns min).
    return $min;
};

$bounded = function ($min = null, $max = null) use ($draw, $scale) {
    $v = $draw();
    return ($min === null) ? $v : $scale($min, $max, $v);
};

uopz_function('rand', $bounded);
uopz_function('mt_rand', $bounded);

// array_rand($arr) / array_rand($arr, $num): pick key(s) by draw order. Only the common
// single-pick form is scripted deterministically; a multi-pick draws $num keys in order.
uopz_function('array_rand', function ($array, $num = 1) use ($draw, $scale) {
    $keys = array_keys($array);
    $n = count($keys);
    if ($n === 0) {
        return null;
    }
    if ($num == 1) {
        return $keys[$scale(0, $n - 1, $draw())];
    }
    $picked = array();
    $pool = $keys;
    for ($k = 0; $k < $num && count($pool) > 0; $k++) {
        $idx = $scale(0, count($pool) - 1, $draw());
        $picked[] = $pool[$idx];
        array_splice($pool, $idx, 1);
    }
    return $picked;
});

// shuffle(&$arr): a Fisher–Yates driven by the scripted draws, matching no native algorithm but
// reproducible and identical to the new server's scripted shuffle.
uopz_function('shuffle', function (&$array) use ($draw, $scale) {
    $values = array_values($array);
    for ($k = count($values) - 1; $k > 0; $k--) {
        $j = $scale(0, $k, $draw());
        $tmp = $values[$k];
        $values[$k] = $values[$j];
        $values[$j] = $tmp;
    }
    $array = $values;
    return true;
});
