from app.services.recipes import runs_bridge, store


async def run_recipe(name: str, inputs: dict | None = None, mode: str = "simulate", trusted: bool = False) -> dict:
    recipe = store.get_recipe(name)
    given = dict(inputs or {})
    task = store.render_task(recipe, given)
    try:
        run = runs_bridge.start(recipe["doc"], task, mode, given, trusted)
    except runs_bridge.RunRefused as err:
        raise store.RecipeError(err.status, err.detail) from err
    return {"run_id": run.id, "status": run.status, "mode": mode, "task": task, "recipe": name}
