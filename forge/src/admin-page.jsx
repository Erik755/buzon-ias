import React from 'react';
// Página de administración con el UI Kit vigente (@forge/react 12, render: native).
// El admin del sitio pega su token bz_ una vez; va por invoke al resolver de administración
// (admin-entry.run), que vuelve a exigir el rol admin en el servidor antes de tocar KVS.
// El token se guarda con kvs.setSecret (por instalación) y NUNCA se devuelve al front.
// Pendiente de ejercitar en entorno Forge real (forge tunnel/deploy): la CLI empaqueta este
// recurso; localmente solo se verifica su sintaxis con esbuild (jsx), no su render.
import { useState } from 'react';
import ForgeReconciler, { Form, Textfield, Label, SectionMessage, Text, useForm } from '@forge/react';
import { invoke } from '@forge/bridge';

const AdminPage = () => {
  const [resultado, setResultado] = useState(null);
  const { handleSubmit, register, getFieldId, reset } = useForm();

  const alEnviar = async ({ token }) => {
    try {
      await invoke('guardarToken', { token });
      const prueba = await invoke('probarToken', {});
      setResultado(prueba.ok
        ? { tipo: 'confirmation', texto: 'Token guardado y verificado contra el buzón.' }
        : { tipo: 'error', texto: `Token guardado pero la prueba falló: ${prueba.detalle}` });
      reset(); // limpiar el campo: el token no se queda en el front
    } catch (e) {
      setResultado({ tipo: 'error', texto: e.message });
    }
  };

  return (
    <>
      <Form onSubmit={handleSubmit(alEnviar)} submitButtonText="Guardar y probar token">
        <Label labelFor={getFieldId('token')}>Token del buzón (bz_…)</Label>
        <Textfield {...register('token', { required: true })} placeholder="bz_…" />
      </Form>
      {resultado && (
        <SectionMessage appearance={resultado.tipo}>
          <Text>{resultado.texto}</Text>
        </SectionMessage>
      )}
      <Text>Cada sitio configura su propio buzón.</Text>
    </>
  );
};

export default AdminPage;

// Con render: native el recurso debe montarse a sí mismo (ForgeReconciler), un default export
// solo no pinta nada. Verificado en el deploy de desarrollo: sin esta llamada el iframe carga
// el bundle pero la página queda en blanco.
ForgeReconciler.render(<AdminPage />);
