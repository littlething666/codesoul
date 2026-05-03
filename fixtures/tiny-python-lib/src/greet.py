def greet(name: str) -> str:
    return f"Hello, {name}!"


class Greeter:
    def __init__(self, name: str) -> None:
        self.name = name

    def message(self) -> str:
        return greet(self.name)
