import os
import tempfile
os.environ['DATABASE_URL'] = 'sqlite:///' + tempfile.mktemp(suffix='.db')
from fastapi.testclient import TestClient
from app.main import app
client = TestClient(app)

def workflow(**kwargs):
    r = client.post('/api/workflows', json={'name':'Test', **kwargs})
    assert r.status_code == 201, r.text
    return r.json()['id']

def test_approval_and_persistence():
    id = workflow()
    r = client.post(f'/api/workflows/{id}/runs', json={'text':'{"amount": 1250}'}).json()
    assert r['status'] == 'awaiting_approval'
    assert r['result'] == {'amount':1250}
    assert client.get(f"/api/runs/{r['id']}").json()['result'] == r['result']
    approved = client.post(f"/api/runs/{r['id']}/decision", json={'approve':True})
    assert approved.json()['status'] == 'completed'
    assert client.post(f"/api/runs/{r['id']}/decision", json={'approve':True}).status_code == 409

def test_rules_stop_output():
    id = workflow(require_approval=False, rules=[{'field':'amount','operator':'greater_than','value':'1000'}])
    run = client.post(f'/api/workflows/{id}/runs', json={'text':'{"amount": 50}'}).json()
    assert run['status'] == 'validation_failed'
    assert not any(s['step'] == 'output' for s in run['steps'])

def test_reject():
    id = workflow()
    run = client.post(f'/api/workflows/{id}/runs', json={'text':'hello'}).json()
    result = client.post(f"/api/runs/{run['id']}/decision", json={'approve':False}).json()
    assert result['status'] == 'rejected'
    assert not any(s['step'] == 'output' for s in result['steps'])

def test_document_upload():
    id = workflow(require_approval=False)
    response = client.post(f'/api/workflows/{id}/upload', files={'file':('data.json',b'{"vendor":"Acme"}','application/json')})
    assert response.status_code == 201
    assert response.json()['status'] == 'completed'
    assert response.json()['result']['vendor'] == 'Acme'
    assert client.post(f'/api/workflows/{id}/upload', files={'file':('bad.pdf',b'not a pdf','application/pdf')}).status_code == 422

def test_webhook_restricted():
    assert client.post('/api/workflows', json={'name':'Bad','output':'webhook','webhook_url':'http://127.0.0.1:8000'}).status_code == 422

def test_openai_adapter(monkeypatch):
    from app import main
    monkeypatch.setenv('LLM_API_KEY','test-only')
    def respond(request):
        assert request.url.host == 'api.openai.com'
        assert request.headers['authorization'] == 'Bearer test-only'
        return main.httpx.Response(200,json={'choices':[{'message':{'content':'{"vendor":"Acme"}'}}]})
    real_client = main.httpx.Client
    monkeypatch.setattr(main.httpx,'Client',lambda **kwargs:real_client(transport=main.httpx.MockTransport(respond),**kwargs))
    result = main.model_result({'provider':'openai','model':'gpt-4o-mini','task':'extract','instructions':'Extract'}, 'Invoice')
    assert result == {'vendor':'Acme'}

def test_ollama_adapter(monkeypatch):
    from app import main
    real_client = main.httpx.Client
    monkeypatch.setattr(main.httpx,'Client',lambda **kwargs:real_client(transport=main.httpx.MockTransport(lambda request:main.httpx.Response(200,json={'response':'{"summary":"ok"}'})),**kwargs))
    assert main.model_result({'provider':'ollama','model':'llama3.2','task':'summarize','instructions':'Summarize'}, 'hello') == {'summary':'ok'}

def test_webhook_delivery_and_failed_delivery(monkeypatch):
    from app import main
    monkeypatch.setenv('WEBHOOK_ALLOWED_HOSTS','hooks.example.com')
    w = workflow(require_approval=False, output='webhook', webhook_url='https://hooks.example.com/results')
    real_client = main.httpx.Client
    sent = []
    def deliver(request):
        sent.append(request)
        assert request.headers['idempotency-key']
        return main.httpx.Response(200)
    monkeypatch.setattr(main.httpx,'Client',lambda **kwargs:real_client(transport=main.httpx.MockTransport(deliver),**kwargs))
    run = client.post(f'/api/workflows/{w}/runs',json={'text':'{"amount":5}'}).json()
    assert run['status']=='completed'
    assert len(sent)==1
    monkeypatch.setattr(main.httpx,'Client',lambda **kwargs:real_client(transport=main.httpx.MockTransport(lambda request:main.httpx.Response(503)),**kwargs))
    run = client.post(f'/api/workflows/{w}/runs',json={'text':'hello'}).json()
    assert run['status']=='failed'

def test_transient_model_retry(monkeypatch):
    from app import main
    attempts=[]
    def retry(w,text):
        attempts.append(1)
        if len(attempts)==1:
            raise main.httpx.ConnectError('test')
        return {'ok':True}
    monkeypatch.setattr(main,'model_result',retry)
    w=workflow(require_approval=False)
    run=client.post(f'/api/workflows/{w}/runs',json={'text':'hello'}).json()
    assert run['status']=='completed'
    assert len(attempts)==2
    assert any(s['status']=='retry' for s in run['steps'])
