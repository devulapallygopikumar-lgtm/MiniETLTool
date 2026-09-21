from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .. import audit, models, schemas
from ..database import get_db
from .datasets import get_dataset_or_404

router = APIRouter(prefix="/api/v1/datasets/{dataset_id}/rules", tags=["rules"])


def to_out(r: models.ValidationRule) -> schemas.ValidationRuleOut:
    return schemas.ValidationRuleOut(
        id=r.id,
        dataset_id=r.dataset_id,
        scope=r.scope,
        column=r.column,
        rule=r.rule,
        args=r.args_json,
        enforcement=r.enforcement,
        on_violation=r.on_violation,
    )


def get_rule_or_404(db: Session, dataset_id: str, rule_id: str) -> models.ValidationRule:
    rule = db.get(models.ValidationRule, rule_id)
    if rule is None or rule.dataset_id != dataset_id:
        raise HTTPException(404, "Rule not found")
    return rule


@router.get("", response_model=list[schemas.ValidationRuleOut])
def list_rules(dataset_id: str, db: Session = Depends(get_db)):
    get_dataset_or_404(db, dataset_id)
    rows = (
        db.query(models.ValidationRule)
        .filter_by(dataset_id=dataset_id)
        .order_by(models.ValidationRule.created_at)
        .all()
    )
    return [to_out(r) for r in rows]


@router.post("", response_model=schemas.ValidationRuleOut, status_code=201)
def create_rule(dataset_id: str, body: schemas.NewRule, db: Session = Depends(get_db)):
    get_dataset_or_404(db, dataset_id)
    rule = models.ValidationRule(
        dataset_id=dataset_id,
        scope=body.scope,
        column=body.column,
        rule=body.rule,
        args_json=body.args,
        enforcement=body.enforcement,
        on_violation=body.on_violation,
    )
    db.add(rule)
    db.flush()
    audit.log(db, "rule.created", "validation_rule", rule.id)
    db.commit()
    db.refresh(rule)
    return to_out(rule)


@router.patch("/{rule_id}", response_model=schemas.ValidationRuleOut)
def update_rule(dataset_id: str, rule_id: str, body: schemas.RulePatch, db: Session = Depends(get_db)):
    get_dataset_or_404(db, dataset_id)
    rule = get_rule_or_404(db, dataset_id, rule_id)
    patch = body.model_dump(exclude_unset=True)
    for key, value in patch.items():
        if key == "args":
            rule.args_json = value
        else:
            setattr(rule, key, value)
    audit.log(db, "rule.updated", "validation_rule", rule.id)
    db.commit()
    db.refresh(rule)
    return to_out(rule)


@router.delete("/{rule_id}", status_code=204)
def delete_rule(dataset_id: str, rule_id: str, db: Session = Depends(get_db)):
    get_dataset_or_404(db, dataset_id)
    rule = get_rule_or_404(db, dataset_id, rule_id)
    db.delete(rule)
    audit.log(db, "rule.deleted", "validation_rule", rule_id)
    db.commit()
    return Response(status_code=204)
