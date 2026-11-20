import pytest

from ari.db import connect, init_db
from ari.domain.workspace import create_workspace


@pytest.fixture
def conn(tmp_path):
    c = connect(tmp_path / "test.db")
    init_db(c)
    yield c
    c.close()


@pytest.fixture
def tutorial(conn):
    """教程工作区：id、revision、snapshot。"""
    return create_workspace(conn, "tutorial")


@pytest.fixture
def empty(conn):
    return create_workspace(conn, None)
