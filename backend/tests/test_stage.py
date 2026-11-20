"""阶段助手：物化与阶段权限校验。"""

import pytest

from ari.agents.stage import (
    PieceOutput,
    PillarOutput,
    PurposeOutput,
    materialize,
    validate_operations,
)
from ari.domain.operations import OperationError, SetPurpose
from ari.domain.seed import tutorial_snapshot


def test_purpose_materialize():
    s = tutorial_snapshot()
    reply, ops = materialize("purpose", PurposeOutput(reply="hi", rewritten_purpose="新目的"), s)
    assert reply == "hi"
    assert ops[0].type == "set_purpose"
    assert ops[0].text == "新目的"


def test_piece_materialize_falls_back_to_root():
    s = tutorial_snapshot()
    out = PieceOutput(reply="hi", fragments=[{"text": "a", "parent_id": None, "kind": "quote"}])
    reply, ops = materialize("piece", out, s)
    assert ops[0].type == "add_piece"
    assert ops[0].parent_id == s.root_id
    assert ops[0].kind == "quote"


def test_pillar_materialize_maps_new_pillar_name_to_id():
    s = tutorial_snapshot()
    out = PillarOutput(
        reply="hi",
        pillars=[{"name": "新支柱"}],
        assignments=[{"piece_id": "p-star", "pillar_name": "新支柱"}],
    )
    _, ops = materialize("pillar", out, s)
    add = next(o for o in ops if o.type == "add_pillar")
    assign = next(o for o in ops if o.type == "assign_piece")
    assert assign.pillar_id == add.id


def test_validate_stage_permission():
    s = tutorial_snapshot()
    with pytest.raises(OperationError, match="不允许"):
        validate_operations("piece", [SetPurpose(text="x")], s)
