"""Tests connectivity to a saved RDBMS connection (app/models.py's
Connection). One driver per engine -- all pure-Python, so no system-level
ODBC/client library install is needed:
  postgres  -> psycopg (already a dependency for the app's own database)
  mysql     -> pymysql
  sqlserver -> python-tds (pytds)

Registry only for now (see models.Connection's docstring) -- this never
reads or writes real data, only opens a connection and runs SELECT 1.
"""

from . import models

_TIMEOUT_SECONDS = 5


def test_connection(conn: models.Connection) -> tuple[bool, str]:
    try:
        if conn.kind == "postgres":
            _test_postgres(conn)
        elif conn.kind == "mysql":
            _test_mysql(conn)
        elif conn.kind == "sqlserver":
            _test_sqlserver(conn)
        else:
            return False, f"Unsupported connection kind: {conn.kind}"
        return True, "Connected successfully."
    except Exception as exc:  # noqa: BLE001 - surfaced to the user as the test result
        return False, str(exc)


def _test_postgres(conn: models.Connection) -> None:
    import psycopg

    with psycopg.connect(
        host=conn.host,
        port=conn.port,
        dbname=conn.database,
        user=conn.username,
        password=conn.password,
        connect_timeout=_TIMEOUT_SECONDS,
    ) as pg:
        pg.execute("SELECT 1")


def _test_mysql(conn: models.Connection) -> None:
    import pymysql

    pg = pymysql.connect(
        host=conn.host,
        port=conn.port,
        database=conn.database,
        user=conn.username,
        password=conn.password,
        connect_timeout=_TIMEOUT_SECONDS,
    )
    try:
        with pg.cursor() as cur:
            cur.execute("SELECT 1")
    finally:
        pg.close()


def _test_sqlserver(conn: models.Connection) -> None:
    import pytds

    with pytds.connect(
        server=conn.host,
        port=conn.port,
        database=conn.database,
        user=conn.username,
        password=conn.password,
        timeout=_TIMEOUT_SECONDS,
        login_timeout=_TIMEOUT_SECONDS,
    ) as sq:
        cur = sq.cursor()
        cur.execute("SELECT 1")
