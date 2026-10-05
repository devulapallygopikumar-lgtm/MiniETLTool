"""Tests connectivity to a saved RDBMS connection (app/models.py's
Connection). One driver per engine -- all pure-Python, so no system-level
ODBC/client library install is needed:
  postgres  -> psycopg (already a dependency for the app's own database)
  mysql     -> pymysql
  sqlserver -> python-tds (pytds)

Also lists a target's tables and columns (information_schema, which all
three engines have) for the field-mapping screen. Still never writes data.
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


_SYSTEM_SCHEMAS = ("pg_catalog", "information_schema", "mysql", "performance_schema", "sys", "pg_toast")


def _connect(conn: models.Connection):
    """A plain DB-API connection. All three drivers accept %s placeholders."""
    if conn.kind == "postgres":
        import psycopg

        return psycopg.connect(
            host=conn.host, port=conn.port, dbname=conn.database, user=conn.username,
            password=conn.password, connect_timeout=_TIMEOUT_SECONDS,
        )
    if conn.kind == "mysql":
        import pymysql

        return pymysql.connect(
            host=conn.host, port=conn.port, database=conn.database, user=conn.username,
            password=conn.password, connect_timeout=_TIMEOUT_SECONDS,
        )
    if conn.kind == "sqlserver":
        import pytds

        return pytds.connect(
            server=conn.host, port=conn.port, database=conn.database, user=conn.username,
            password=conn.password, timeout=_TIMEOUT_SECONDS, login_timeout=_TIMEOUT_SECONDS,
        )
    raise ValueError(f"Unsupported connection kind: {conn.kind}")


def _query(conn: models.Connection, sql: str, params: tuple) -> list[tuple]:
    db = _connect(conn)
    try:
        cur = db.cursor()
        cur.execute(sql, params)
        return list(cur.fetchall())
    finally:
        db.close()


def list_tables(conn: models.Connection) -> list[tuple[str, str]]:
    """(schema, table) for every base table the login can see, limited to the
    connection's schema when one is set (MySQL: its database)."""
    placeholders = ", ".join(["%s"] * len(_SYSTEM_SCHEMAS))
    sql = (
        "SELECT table_schema, table_name FROM information_schema.tables "
        f"WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ({placeholders})"
    )
    params: tuple = _SYSTEM_SCHEMAS
    schema = conn.database if conn.kind == "mysql" else conn.schema_name
    if schema:
        sql += " AND table_schema = %s"
        params = params + (schema,)
    sql += " ORDER BY table_schema, table_name"
    return [(str(r[0]), str(r[1])) for r in _query(conn, sql, params)]


def list_columns(conn: models.Connection, schema: str, table: str) -> list[dict]:
    rows = _query(
        conn,
        "SELECT column_name, data_type, is_nullable, column_default "
        "FROM information_schema.columns WHERE table_schema = %s AND table_name = %s "
        "ORDER BY ordinal_position",
        (schema, table),
    )
    return [
        {
            "name": str(r[0]),
            "type": str(r[1]),
            "nullable": str(r[2]).upper() == "YES",
            "has_default": r[3] is not None,
        }
        for r in rows
    ]
