from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from starlette.responses import StreamingResponse


from routes.airspace import router as AirspaceRouter
from routes.constraints import router as ConstraintsRouter
from routes.health import router as HealthRouter
from routes.scenarios import router as ScenariosRouter
from schemas.api import ApiException
import logging


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan event for the FastAPI application.
    """
    yield


app = FastAPI(
    title="UTM Observer API",
    description=(
        "BR-UTM Observer Backend Service for managing for ecosystem"
        " interaction"
    ),
    version="1.0.0",
    lifespan=lifespan,
    root_path="/api",
)

logging.basicConfig(
    level=logging.DEBUG,
)


@app.middleware("http")
async def catch_exceptions_middleware(request: Request, call_next):
    try:
        logging.info(
            f"[API REQUEST] {request.method} {request.url.path} - "
            f"Headers: {request.headers}, "
            f"Body: {(await request.body())[:2000]!r}"
        )
        response = await call_next(request)
        body = b"".join([chunk async for chunk in response.body_iterator])
        logging.info(
            f"[API RESPONSE] {request.method} {request.url.path} - Status:"
            f" {response.status_code}, Headers: {response.headers}, Body:"
            f"{body[:2000]!r}"
        )
        return StreamingResponse(
            iter([body]),
            status_code=response.status_code,
            headers=response.headers,
            media_type=response.media_type,
            background=response.background,
        )
    except Exception as e:
        if hasattr(e, "status_code"):
            raise e

        raise ApiException(
            status_code=500,
            message=str(e),
        )


origins = [
    "http://localhost",
    "http://localhost:8080",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(AirspaceRouter, tags=["Airspace"], prefix="/airspace")
app.include_router(
    ConstraintsRouter, tags=["Constraints"], prefix="/constraints"
)
app.include_router(HealthRouter, tags=["Health"], prefix="/healthy")
app.include_router(
    ScenariosRouter, tags=["Scenarios"], prefix="/scenarios"
)
