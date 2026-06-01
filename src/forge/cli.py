import typer

app = typer.Typer(name="forge", help="Idea to product in one command.")


@app.command()
def build(idea: str = typer.Argument(..., help="What to build")) -> None:
    typer.echo(f"Starting build for: {idea}")


@app.command()
def setup() -> None:
    typer.echo("Setup wizard coming soon.")


@app.command()
def sessions() -> None:
    typer.echo("Sessions coming soon.")


@app.command()
def resume(session_id: str = typer.Argument(None)) -> None:
    typer.echo(f"Resume {session_id or 'last'} coming soon.")


@app.command()
def logs(session_id: str = typer.Argument(None)) -> None:
    typer.echo(f"Logs for {session_id or 'last'} coming soon.")


if __name__ == "__main__":
    app()
