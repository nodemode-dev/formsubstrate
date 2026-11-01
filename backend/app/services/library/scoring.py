import re


def terms(text: str) -> set[str]:
    return {part for part in re.split(r"\W+", text.lower()) if len(part) > 2}


def score_lexical(query: str, text: str) -> float:
    wanted = [part for part in re.split(r"\W+", query.lower()) if len(part) > 2]
    if not wanted:
        return 0.0
    body = text.lower()
    return sum(body.count(part) for part in wanted) / (1 + len(body) / 400)


def score(query: str, texts: list[str]) -> list[float]:
    return [score_lexical(query, text) for text in texts]


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)
