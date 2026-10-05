import uuid

import pytest

from app.id_generators import make_id_generator


def test_uuid_ids_are_unique_v4():
    gen = make_id_generator({"kind": "uuid"})
    a, b = gen(), gen()
    assert a != b
    assert uuid.UUID(a).version == 4


def test_sequence_with_prefix_and_padding():
    gen = make_id_generator({"kind": "sequence", "prefix": "INV-", "start": 1, "pad": 5})
    assert [gen(), gen(), gen()] == ["INV-00001", "INV-00002", "INV-00003"]


def test_sequence_defaults_and_step():
    assert make_id_generator({"kind": "sequence"})() == "1"
    gen = make_id_generator({"kind": "sequence", "start": 100, "step": 10})
    assert [gen(), gen()] == ["100", "110"]


def test_each_generator_counts_independently():
    spec = {"kind": "sequence"}
    a, b = make_id_generator(spec), make_id_generator(spec)
    assert (a(), a(), b()) == ("1", "2", "1")


def test_unknown_kind_rejected():
    with pytest.raises(ValueError):
        make_id_generator({"kind": "snowflake"})
