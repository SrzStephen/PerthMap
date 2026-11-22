import numpy as np

from pipeline import DIRECT, NONE, combine, summarise

E = np.array([], dtype=float)
EI = np.array([], dtype=np.int64)


def test_picks_min_stop_per_sample():
    # cell 0 reachable from stop 0 (walk 5) and stop 1 (walk 2)
    stop_minutes = np.array([[10.0, 30.0], [20.0, 12.0]])
    c = combine(2, np.array([0, 0]), np.array([0, 1]), np.array([5.0, 2.0]), stop_minutes, EI, E)
    assert c.total[:, 0].tolist() == [15, 14]
    assert c.stop[:, 0].tolist() == [0, 1]
    assert c.walk[:, 0].tolist() == [5, 2]


def test_direct_walk_wins():
    stop_minutes = np.array([[10.0, 30.0]])
    # transit totals 15 / 35; direct walk 20 wins only the second sample
    c = combine(2, np.array([1]), np.array([0]), np.array([5.0]), stop_minutes, np.array([1]), np.array([20.0]))
    assert c.stop[:, 1].tolist() == [0, DIRECT]
    assert c.total[:, 1].tolist() == [15, 20]
    assert c.walk[:, 1].tolist() == [5, 20]


def test_unreachable_cell():
    c = combine(2, np.array([0]), np.array([0]), np.array([1.0]), np.array([[3.0]]), EI, E)
    assert np.isnan(c.total[0, 1])
    assert c.stop[0, 1] == NONE
    s = summarise(c)
    assert np.isnan(s.fastest[1]) and np.isnan(s.median[1])
    assert s.sample[1] == -1 and s.stop[1] == NONE


def test_summarise_fastest_sample():
    stop_minutes = np.array([[10.0, 30.0], [20.0, 12.0]])
    c = combine(1, np.array([0, 0]), np.array([0, 1]), np.array([5.0, 2.0]), stop_minutes, EI, E)
    s = summarise(c)
    assert s.median[0] == 14.5 and s.fastest[0] == 14
    assert s.sample[0] == 1 and s.stop[0] == 1 and s.walk[0] == 2


def test_matches_brute_force():
    rng = np.random.default_rng(1)
    n_cells, n_stops, n_t = 50, 8, 4
    pairs = [(c, s) for c in range(n_cells) for s in range(n_stops) if rng.random() < 0.3]
    g_idx = np.array([p[0] for p in pairs])
    g_stop = np.array([p[1] for p in pairs])
    g_walk = rng.uniform(1, 15, len(pairs))
    sm = rng.uniform(5, 60, (n_stops, n_t))
    sm[rng.random(sm.shape) < 0.2] = np.nan
    w_idx = np.arange(0, n_cells, 7)
    w_min = rng.uniform(5, 40, len(w_idx))
    c = combine(n_cells, g_idx, g_stop, g_walk, sm, w_idx, w_min)
    for j in range(n_t):
        for cell in range(n_cells):
            best, stop = np.inf, NONE
            for k, (gc, gs) in enumerate(pairs):
                v = g_walk[k] + sm[gs, j]
                if gc == cell and not np.isnan(v) and v < best:
                    best, stop = v, gs
            if cell in w_idx:
                w = w_min[list(w_idx).index(cell)]
                if w < best:
                    best, stop = w, DIRECT
            if np.isinf(best):
                assert np.isnan(c.total[j, cell])
            else:
                assert np.isclose(c.total[j, cell], best) and c.stop[j, cell] == stop
