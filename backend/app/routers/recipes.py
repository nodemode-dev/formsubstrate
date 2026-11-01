from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.core.local_guard import require_window
from app.services.recipes import launch, store

router = APIRouter()


class RecipeBody(BaseModel):
    name: str
    description: str = ""
    doc: dict
    task_template: str = ""
    inputs: list[dict] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)


class RunBody(BaseModel):
    inputs: dict = Field(default_factory=dict)
    mode: str = "simulate"


def _fail(err: store.RecipeError) -> HTTPException:
    return HTTPException(status_code=err.status, detail=err.detail)


@router.get("/recipes")
async def list_all() -> dict:
    try:
        recipes = await run_in_threadpool(store.list_recipes)
        error = ""
    except store.RecipeError as err:
        recipes, error = [], err.detail
    return {"recipes": recipes, "presets": await run_in_threadpool(store.list_presets), "note": error}


@router.get("/recipes/{name}")
async def get_one(name: str) -> dict:
    try:
        return await run_in_threadpool(store.get_recipe, name)
    except store.RecipeError as err:
        raise _fail(err)


@router.put("/recipes/{name}", dependencies=[Depends(require_window)])
async def save(name: str, body: RecipeBody) -> dict:
    if name != body.name:
        raise HTTPException(status_code=400, detail="the name in the path and the body must match")
    try:
        return await run_in_threadpool(store.save_recipe, body.model_dump())
    except store.RecipeError as err:
        raise _fail(err)


@router.delete("/recipes/{name}", dependencies=[Depends(require_window)])
async def delete(name: str) -> dict:
    try:
        await run_in_threadpool(store.delete_recipe, name)
    except store.RecipeError as err:
        raise _fail(err)
    return {"deleted": name}


@router.post("/recipes/{name}/run", dependencies=[Depends(require_window)])
async def run(name: str, body: RunBody | None = None) -> dict:
    try:
        return await launch.run_recipe(name, body.inputs if body else {}, body.mode if body else "simulate")
    except store.RecipeError as err:
        raise _fail(err)


@router.post("/recipes/presets/{name}/install", dependencies=[Depends(require_window)])
async def install_preset(name: str) -> dict:
    try:
        recipe = await run_in_threadpool(store.install_preset, name)
    except store.RecipeError as err:
        raise _fail(err)
    return {"installed": recipe["name"]}
