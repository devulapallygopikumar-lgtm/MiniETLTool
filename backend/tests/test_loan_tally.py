from datetime import date
from decimal import Decimal

from app.routers.loan_tally import compare


def row(d, balance, parent="Personal Loan"):
    return {"date": d, "running_balance": balance, "parent": parent}


def test_exact_match_is_tallied_on_that_rows_date():
    rows = [row(date(2023, 4, 15), 3000), row(date(2023, 4, 27), 195800), row(date(2023, 5, 10), 190800)]
    out = compare(Decimal("195800"), rows)
    assert out == {
        "ledger_date": date(2023, 4, 27),
        "running_total": Decimal("195800.00"),
        "difference": Decimal("0.00"),
        "status": "Tallied",
    }


def test_several_matches_use_the_latest():
    rows = [row(date(2023, 1, 1), 500), row(date(2023, 2, 1), 900), row(date(2023, 3, 1), 500)]
    assert compare(Decimal("500"), rows)["ledger_date"] == date(2023, 3, 1)


def test_no_match_uses_the_closest_balance_and_is_not_tallied():
    rows = [row(date(2023, 1, 1), 1000), row(date(2023, 2, 1), 1480), row(date(2023, 3, 1), 3000)]
    out = compare(Decimal("1500"), rows)
    assert out["status"] == "Not Tallied"
    assert out["ledger_date"] == date(2023, 2, 1)
    assert out["running_total"] == Decimal("1480.00")
    assert out["difference"] == Decimal("20.00")  # principal outstanding - running total


def test_every_ledger_counts_including_interest():
    rows = [row(date(2023, 1, 1), 100, "Personal Loan"), row(date(2023, 2, 1), -3000, "Interest Income")]
    out = compare(Decimal("-3000"), rows)
    assert out["status"] == "Tallied"
    assert out["ledger_date"] == date(2023, 2, 1)


def test_no_rows_or_no_principal_is_not_tallied_with_blanks():
    blank = {"ledger_date": None, "running_total": None, "difference": None, "status": "Not Tallied"}
    assert compare(Decimal("100"), []) == blank
    assert compare(None, [row(date(2023, 1, 1), 100)]) == blank


def test_sub_cent_noise_is_rounded_away():
    out = compare(Decimal("100.004"), [row(date(2023, 1, 1), Decimal("99.996"))])
    assert out["status"] == "Tallied"
