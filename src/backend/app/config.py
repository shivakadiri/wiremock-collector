from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://collector:collector@localhost:5432/wiremock_collector"
    collect_interval_seconds: int = 15
    static_dir: str = ""
    cors_origins: str = "http://localhost:5173"
    docker_socket: str = "/var/run/docker.sock"
    docker_host_gateway: str = "host.docker.internal"
    docker_auto_discover_on_startup: bool = True


settings = Settings()
